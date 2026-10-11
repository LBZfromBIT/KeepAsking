import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AppData, ChatNode, Message, Session, SettingsState, SettingsUpdate } from '../../shared/types';
import { buildContext, childrenOf, descendantIds, pathTo } from '../../shared/context';
import { streamChat } from './chatClient';
import { rangeOffsets } from './markdown';
import { truncate, uid } from './util';
import { MessageView } from './components/MessageView';
import { TreePanel } from './components/TreePanel';
import { SettingsModal } from './components/SettingsModal';
import { BranchPopover, type PendingSelection } from './components/BranchPopover';

const EXAMPLES = ['解释一下 Transformer 的注意力机制', '量子纠缠到底是什么？', '如何系统地学习一门陌生领域？'];

function patchNode(d: AppData, id: string, fn: (n: ChatNode) => ChatNode): AppData {
  const n = d.nodes[id];
  if (!n) return d;
  const next = fn(n);
  const s = d.sessions[n.sessionId];
  return {
    ...d,
    nodes: { ...d.nodes, [id]: next },
    sessions: s ? { ...d.sessions, [s.id]: { ...s, updatedAt: Date.now() } } : d.sessions,
  };
}

function patchMessage(d: AppData, nodeId: string, msgId: string, fn: (m: Message) => Message): AppData {
  return patchNode(d, nodeId, (n) => ({ ...n, messages: n.messages.map((m) => (m.id === msgId ? fn(m) : m)) }));
}

interface AppProps {
  initialData: AppData;
  initialSettings: SettingsState;
}

export default function App({ initialData, initialSettings }: AppProps) {
  const [data, setData] = useState<AppData>(initialData);
  const dataRef = useRef(data);
  const [settings, setSettings] = useState<SettingsState>(initialSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [showSettings, setShowSettings] = useState(false);
  const [showTree, setShowTree] = useState(true);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [streaming, setStreaming] = useState<Set<string>>(new Set());
  const [flashBranch, setFlashBranch] = useState<string | null>(null);
  const controllers = useRef(new Map<string, AbortController>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);

  const commit = useCallback((fn: (d: AppData) => AppData) => {
    const next = fn(dataRef.current);
    dataRef.current = next;
    setData(next);
  }, []);

  // Debounced persistence to userData/data.json (via main process)
  const dirty = useRef(false);
  useEffect(() => {
    if (data === initialData) return;
    dirty.current = true;
    const t = setTimeout(() => {
      dirty.current = false;
      void window.api.data.save(data);
    }, 400);
    return () => clearTimeout(t);
  }, [data, initialData]);
  useEffect(() => {
    const f = () => {
      if (dirty.current) window.api.data.saveSync(dataRef.current);
    };
    window.addEventListener('beforeunload', f);
    return () => window.removeEventListener('beforeunload', f);
  }, []);

  const session = data.currentSessionId ? data.sessions[data.currentSessionId] : undefined;
  const node = data.currentNodeId ? data.nodes[data.currentNodeId] : undefined;
  const path = useMemo(() => pathTo(data.nodes, data.currentNodeId), [data.nodes, data.currentNodeId]);
  const kids = useMemo(() => (node ? childrenOf(data.nodes, node.id) : []), [data.nodes, node]);
  const sessions = useMemo(
    () => Object.values(data.sessions).sort((a, b) => b.updatedAt - a.updatedAt),
    [data.sessions],
  );

  const navigate = useCallback(
    (nodeId: string, flash?: string) => {
      const n = dataRef.current.nodes[nodeId];
      if (!n) return;
      setPending(null);
      stickBottom.current = !flash;
      commit((d) => ({ ...d, currentNodeId: nodeId, currentSessionId: n.sessionId }));
      setFlashBranch(flash ?? null);
    },
    [commit],
  );

  // After returning to a parent, scroll to & flash the branch's highlighted span
  useLayoutEffect(() => {
    if (flashBranch) {
      const el = document.querySelector(`mark[data-branch-id="${flashBranch}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1600);
      }
      setFlashBranch(null);
    } else if (stickBottom.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [data, flashBranch]);

  const generate = useCallback(
    async (nodeId: string) => {
      const ctx = buildContext(dataRef.current.nodes, nodeId);
      const msgId = uid();
      commit((d) =>
        patchNode(d, nodeId, (n) => ({
          ...n,
          messages: [...n.messages, { id: msgId, role: 'assistant', content: '', status: 'streaming', createdAt: Date.now() }],
        })),
      );
      const ac = new AbortController();
      controllers.current.set(nodeId, ac);
      setStreaming((s) => new Set(s).add(nodeId));

      let buf = '';
      let raf = 0;
      const flush = () => {
        raf = 0;
        if (!buf) return;
        const chunk = buf;
        buf = '';
        commit((d) => patchMessage(d, nodeId, msgId, (m) => ({ ...m, content: m.content + chunk })));
      };
      try {
        await streamChat(
          ctx,
          (t) => {
            buf += t;
            if (!raf) raf = requestAnimationFrame(flush);
          },
          ac.signal,
        );
        if (raf) cancelAnimationFrame(raf);
        flush();
        commit((d) => patchMessage(d, nodeId, msgId, (m) => ({ ...m, status: 'done' })));
      } catch (e: any) {
        if (raf) cancelAnimationFrame(raf);
        flush();
        const aborted = e?.name === 'AbortError';
        const msg = String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
        commit((d) =>
          patchMessage(d, nodeId, msgId, (m) =>
            aborted
              ? { ...m, status: m.content ? 'done' : 'error', error: '已停止' }
              : { ...m, status: 'error', error: msg },
          ),
        );
      } finally {
        controllers.current.delete(nodeId);
        setStreaming((s) => {
          const n = new Set(s);
          n.delete(nodeId);
          return n;
        });
      }
    },
    [commit],
  );

  const ensureKey = () => {
    if (!settingsRef.current.hasApiKey && !/localhost|127\.0\.0\.1/.test(settingsRef.current.baseUrl)) {
      setShowSettings(true);
      return false;
    }
    return true;
  };

  const newSession = useCallback(() => {
    const sid = uid();
    const rid = uid();
    const now = Date.now();
    const s: Session = { id: sid, title: '新对话', rootId: rid, createdAt: now, updatedAt: now };
    const root: ChatNode = { id: rid, sessionId: sid, parentId: null, title: '新对话', messages: [], createdAt: now };
    commit((d) => ({
      ...d,
      sessions: { ...d.sessions, [sid]: s },
      nodes: { ...d.nodes, [rid]: root },
      currentSessionId: sid,
      currentNodeId: rid,
    }));
    return rid;
  }, [commit]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || !ensureKey()) return;
    let nodeId = dataRef.current.currentNodeId;
    if (!nodeId || !dataRef.current.nodes[nodeId]) nodeId = newSession();
    if (streaming.has(nodeId)) return;
    const msg: Message = { id: uid(), role: 'user', content: t, status: 'done', createdAt: Date.now() };
    commit((d) => {
      let next = patchNode(d, nodeId!, (n) => ({
        ...n,
        title: !n.parentId && n.messages.length === 0 ? truncate(t, 30) : n.title,
        messages: [...n.messages, msg],
      }));
      const n = next.nodes[nodeId!];
      const s = next.sessions[n.sessionId];
      if (!n.parentId && s && s.title === '新对话') next = { ...next, sessions: { ...next.sessions, [s.id]: { ...s, title: truncate(t, 30) } } };
      return next;
    });
    setInput('');
    stickBottom.current = true;
    generate(nodeId);
  };

  const createBranch = (sel: PendingSelection, question: string) => {
    const parent = dataRef.current.nodes[dataRef.current.currentNodeId!];
    if (!parent || !ensureKey()) return;
    const id = uid();
    const now = Date.now();
    const child: ChatNode = {
      id,
      sessionId: parent.sessionId,
      parentId: parent.id,
      anchor: { messageId: sel.messageId, start: sel.start, end: sel.end, text: sel.text },
      title: truncate(question.trim() || sel.text, 24),
      messages: [{ id: uid(), role: 'user', content: question.trim(), quote: sel.text, status: 'done', createdAt: now }],
      createdAt: now,
    };
    window.getSelection()?.removeAllRanges();
    setPending(null);
    stickBottom.current = true;
    commit((d) => ({ ...d, nodes: { ...d.nodes, [id]: child }, currentNodeId: id }));
    generate(id);
  };

  const regenerate = (nodeId: string, msgId: string) => {
    if (streaming.has(nodeId) || !ensureKey()) return;
    commit((d) => patchNode(d, nodeId, (n) => ({ ...n, messages: n.messages.filter((m) => m.id !== msgId) })));
    generate(nodeId);
  };

  const stop = (nodeId: string) => controllers.current.get(nodeId)?.abort();

  const deleteNode = (nodeId: string) => {
    const d0 = dataRef.current;
    const n = d0.nodes[nodeId];
    if (!n) return;
    const isRoot = !n.parentId;
    if (!confirm(isRoot ? '删除整个会话及其所有分支？' : `删除分支「${n.title}」及其子分支？`)) return;
    const ids = descendantIds(d0.nodes, nodeId);
    ids.forEach((i) => controllers.current.get(i)?.abort());
    commit((d) => {
      const nodes = { ...d.nodes };
      ids.forEach((i) => delete nodes[i]);
      const sessions = { ...d.sessions };
      if (isRoot) delete sessions[n.sessionId];
      const cur = d.currentNodeId && nodes[d.currentNodeId] ? d.currentNodeId : isRoot ? null : n.parentId;
      return {
        ...d,
        nodes,
        sessions,
        currentNodeId: cur,
        currentSessionId: cur ? nodes[cur].sessionId : null,
      };
    });
  };

  const deleteSession = (s: Session) => deleteNode(s.rootId);

  const renameSession = (s: Session) => {
    const t = prompt('重命名会话', s.title);
    if (!t?.trim()) return;
    commit((d) => ({ ...d, sessions: { ...d.sessions, [s.id]: { ...s, title: t.trim() } } }));
  };

  const exportJson = async () => {
    const path = await window.api.data.exportToFile(
      JSON.stringify(dataRef.current, null, 2),
      `branch-chat-${new Date().toISOString().slice(0, 10)}.json`,
    );
    if (path) alert(`已导出到：${path}`);
  };

  const importJson = async () => {
    try {
      const text = await window.api.data.importFromFile();
      if (text === null) return;
      const imp = JSON.parse(text) as AppData;
      if (!imp.sessions || !imp.nodes) throw new Error('格式不正确');
      commit((d) => ({
        ...d,
        sessions: { ...d.sessions, ...imp.sessions },
        nodes: { ...d.nodes, ...imp.nodes },
      }));
      alert(`已导入 ${Object.keys(imp.sessions).length} 个会话`);
    } catch (e: any) {
      alert('导入失败：' + (e?.message || e));
    }
  };

  // Text selection inside a message -> branch popover
  const onMouseUp = () => {
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const startEl = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement) as HTMLElement;
      const endEl = (range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement) as HTMLElement;
      const box = startEl?.closest('[data-message-id]') as HTMLElement | null;
      if (!box || box !== endEl?.closest('[data-message-id]')) return;
      const off = rangeOffsets(box, range);
      if (!off.text.trim()) return;
      const rect = range.getBoundingClientRect();
      setPending({ messageId: box.dataset.messageId!, ...off, x: rect.left, y: rect.top });
    }, 0);
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (pending) setPending(null);
  };

  const isStreaming = node ? streaming.has(node.id) : false;
  const parent = node?.parentId ? data.nodes[node.parentId] : undefined;
  const lastMsg = node?.messages[node.messages.length - 1];

  return (
    <div className={`app ${showTree ? 'with-tree' : ''}`}>
      <aside className="sidebar">
        <div className="brand">🌳 分支对话</div>
        <button className="primary block" onClick={() => newSession()}>＋ 新建对话</button>
        <div className="session-list">
          {sessions.length === 0 && <div className="empty-small">还没有会话</div>}
          {sessions.map((s) => {
            const count = Object.values(data.nodes).filter((n) => n.sessionId === s.id).length;
            return (
              <div
                key={s.id}
                className={`session ${s.id === data.currentSessionId ? 'active' : ''}`}
                onClick={() => navigate(s.rootId)}
                onDoubleClick={() => renameSession(s)}
                title="双击重命名"
              >
                <div className="session-title">{s.title}</div>
                <div className="session-meta">
                  {count > 1 ? `${count - 1} 个分支 · ` : ''}
                  {new Date(s.updatedAt).toLocaleDateString('zh-CN')}
                </div>
                <button
                  className="session-del"
                  title="删除"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSession(s);
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <div className="sidebar-foot">
          <button className="block" onClick={() => setShowSettings(true)} data-testid="open-settings">
            ⚙️ 设置 {settings.hasApiKey ? '' : <span className="dot-warn">未配置 Key</span>}
          </button>
          <div className="row">
            <button className="sm grow" onClick={exportJson}>导出 JSON</button>
            <button className="sm grow" onClick={importJson}>导入 JSON</button>
          </div>
          <button className="sm link" onClick={() => window.api.data.openDataFolder()}>打开数据目录</button>
          <div className="model-tag" title={settings.baseUrl}>
            {settings.provider === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容'} · {settings.model}
          </div>
        </div>
      </aside>

      <main className="chat">
        <header className="chat-head">
          <nav className="crumbs">
            {path.length === 0 && <span>欢迎</span>}
            {path.map((n, i) => (
              <span key={n.id}>
                {i > 0 && <span className="sep">›</span>}
                <button
                  className={`crumb ${n.id === node?.id ? 'cur' : ''}`}
                  onClick={() => navigate(n.id, path[i + 1]?.id)}
                >
                  {i === 0 ? '🌳 ' : '🌿 '}
                  {truncate(n.title, 16)}
                </button>
              </span>
            ))}
          </nav>
          <div className="head-actions">
            {node?.parentId && (
              <button className="sm" onClick={() => deleteNode(node.id)}>删除分支</button>
            )}
            <button className="sm" onClick={() => setShowTree(!showTree)}>{showTree ? '隐藏对话树' : '显示对话树'}</button>
          </div>
        </header>

        {node?.anchor && parent && (
          <div className="branch-banner">
            <span>分支自「{truncate(parent.title, 16)}」中的：</span>
            <q>{truncate(node.anchor.text, 80)}</q>
            <button className="link" onClick={() => navigate(parent.id, node.id)}>← 返回原文</button>
          </div>
        )}

        <div className="messages" ref={scrollRef} onMouseUp={onMouseUp} onScroll={onScroll}>
          {(!node || node.messages.length === 0) && (
            <div className="welcome">
              <h1>不止线性对话</h1>
              <p>向 AI 提问，然后在回答中<b>划选任意文字</b>，点击「🌿 展开分支」即可围绕这段内容开启一条新的分支对话。右侧的对话树会实时生长，帮你把发散的探索整理成知识地图。</p>
              <div className="examples">
                {EXAMPLES.map((e) => (
                  <button key={e} className="chip" onClick={() => send(e)}>{e}</button>
                ))}
              </div>
              {!settings.hasApiKey && (
                <p className="hint">
                  首次使用请先在 <button className="link" onClick={() => setShowSettings(true)}>设置</button> 中填写你的 API Key。
                </p>
              )}
            </div>
          )}
          {node?.messages.map((m) => (
            <MessageView
              key={m.id}
              message={m}
              branches={kids.filter((k) => k.anchor?.messageId === m.id)}
              onOpenBranch={navigate}
              onStop={() => stop(node.id)}
              onRegenerate={m.id === lastMsg?.id && m.role === 'assistant' ? () => regenerate(node.id, m.id) : undefined}
            />
          ))}
        </div>

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={node?.parentId ? '在此分支中继续追问…（Enter 发送，Shift+Enter 换行）' : '输入问题…（Enter 发送，Shift+Enter 换行）'}
            rows={2}
          />
          {isStreaming ? (
            <button type="button" className="danger" onClick={() => stop(node!.id)}>停止</button>
          ) : (
            <button type="submit" className="primary" disabled={!input.trim()}>发送</button>
          )}
        </form>
      </main>

      {showTree && (
        <aside className="tree-panel">
          <div className="tree-head">
            <span>对话树</span>
            {session && <span className="muted">{Object.values(data.nodes).filter((n) => n.sessionId === session.id).length} 个节点</span>}
          </div>
          {session ? (
            <TreePanel
              nodes={data.nodes}
              rootId={session.rootId}
              currentId={data.currentNodeId}
              streamingIds={streaming}
              onSelect={(id) => navigate(id)}
            />
          ) : (
            <div className="empty-small">开始对话后，这里会显示对话树</div>
          )}
          <div className="tree-tip">💡 划选回答中的文字即可创建分支；点击节点切换对话</div>
        </aside>
      )}

      {pending && (
        <BranchPopover sel={pending} onBranch={(q) => createBranch(pending, q)} onClose={() => setPending(null)} />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSave={async (u: SettingsUpdate) => {
            try {
              setSettings(await window.api.settings.save(u));
              setShowSettings(false);
            } catch (e: any) {
              alert('保存失败：' + (e?.message || e));
            }
          }}
        />
      )}
    </div>
  );
}
