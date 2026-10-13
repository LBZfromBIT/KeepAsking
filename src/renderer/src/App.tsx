import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AppData, ChatNode, Message, ModelInfo, Session, Settings, SettingsState, SettingsUpdate } from '../../shared/types';
import { toSettings } from '../../shared/types';
import { contextBreakdown, formatTokenCount, resolveContextWindow } from '../../shared/usage';
import { applyAppearance } from './appearance';
import { buildContext, childrenOf, COMPACT_ASK, descendantIds, pathTo } from '../../shared/context';
import { streamChat } from './chatClient';
import { rangeOffsets } from './markdown';
import { truncate, uid } from './util';
import { ComposerPick, EFFORT_LABEL } from './components/ComposerPick';
import { ContextUsage } from './components/ContextUsage';
import { MessageView } from './components/MessageView';
import { TreePanel } from './components/TreePanel';
import { SettingsModal } from './components/SettingsModal';
import { AskMenu, ProbePanel } from './components/ProbePanel';
import type { PendingSelection } from './components/selection';
import { TurnRail } from './components/TurnRail';

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
  const previewAppearance = useCallback((patch: Pick<Settings, 'theme' | 'fontLatin' | 'fontCjk'>) => {
    applyAppearance(patch);
  }, []);

  useEffect(() => {
    applyAppearance(settings);
    if (settings.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyAppearance(settings);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [settings]);
  const [catalog, setCatalog] = useState<ModelInfo[]>([]);
  const loadGen = useRef(0);
  const saveChain = useRef(Promise.resolve());
  const reloadModels = useCallback(() => {
    const gen = ++loadGen.current;
    const { provider, baseUrl, hasApiKey } = settingsRef.current;
    if (!hasApiKey && !/localhost|127\.0\.0\.1/.test(baseUrl)) {
      setCatalog([]);
      return;
    }
    void window.api.models.list({ provider, baseUrl }).then(
      (list) => {
        if (loadGen.current !== gen) return;
        setCatalog(list);
      },
      () => {
        if (loadGen.current !== gen) return;
        setCatalog([]);
      },
    );
  }, []);
  const patchSettings = (patch: Partial<Settings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    const payload = toSettings(next);
    saveChain.current = saveChain.current
      .catch(() => undefined)
      .then(() => window.api.settings.save({ settings: payload }))
      .then((saved) => {
        setSettings((cur) => (cur.model === payload.model && cur.thinkingEffort === payload.thinkingEffort ? saved : cur));
      });
  };
  useEffect(() => {
    reloadModels();
  }, [settings.provider, settings.baseUrl, settings.hasApiKey, reloadModels]);
  const [showSettings, setShowSettings] = useState(false);
  const [showTree, setShowTree] = useState(true);
  const [input, setInput] = useState('');
  const [pickOpen, setPickOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [compactError, setCompactError] = useState('');
  const tagRef = useRef<HTMLDivElement>(null);
  const usageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pickOpen && !usageOpen) return;
    const down = (e: MouseEvent) => {
      const target = e.target as Node;
      if (pickOpen && tagRef.current && !tagRef.current.contains(target)) setPickOpen(false);
      if (usageOpen && usageRef.current && !usageRef.current.contains(target)) setUsageOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (tagRef.current?.querySelector('[data-testid=composer-model-list]')) return;
      if (pickOpen) {
        setPickOpen(false);
        return;
      }
      setUsageOpen(false);
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [pickOpen, usageOpen]);
  const [askAt, setAskAt] = useState<PendingSelection | null>(null);
  const [probeDraft, setProbeDraft] = useState<PendingSelection | null>(null);
  const [openProbeId, setOpenProbeId] = useState<string | null>(null);
  const [probeAnchor, setProbeAnchor] = useState({ x: 80, y: 80 });
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
  const saveGen = useRef(0);
  useEffect(() => {
    if (data === initialData) return;
    const gen = ++saveGen.current;
    dirty.current = true;
    const t = setTimeout(() => {
      if (saveGen.current !== gen) return;
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
  const modelOptions = useMemo(() => {
    const ids = catalog.map((m) => m.id);
    if (settings.model && !ids.includes(settings.model)) return [settings.model, ...ids];
    return ids.length ? ids : [settings.model].filter(Boolean);
  }, [catalog, settings.model]);
  const contextUsage = useMemo(() => {
    const messages = node ? buildContext(data.nodes, node.id) : [];
    const draft = input.trim();
    const { parts, used } = contextBreakdown(settings.systemPrompt, messages, draft);
    const reported = catalog.find((m) => m.id === settings.model)?.contextWindow ?? null;
    const limit = resolveContextWindow(settings.model, reported);
    const ratio = limit ? used / limit : 0;
    const level: 'ok' | 'warn' | 'hot' | 'none' = !limit ? 'none' : ratio >= 0.9 ? 'hot' : ratio >= 0.7 ? 'warn' : 'ok';
    const label = limit ? `约 ${formatTokenCount(used)} / ${formatTokenCount(limit)}` : `约 ${formatTokenCount(used)}`;
    const compact = limit ? `${formatTokenCount(used)}/${formatTokenCount(limit)}` : formatTokenCount(used);
    const tokensOf = (kind: 'system' | 'draft') => parts.filter((p) => p.kind === kind).reduce((n, p) => n + p.tokens, 0);
    const system = tokensOf('system');
    const draftTokens = tokensOf('draft');
    const messageTokens = used - system - draftTokens;
    const rows: { id: string; label: string; tokens: number }[] = [];
    if (system > 0) rows.push({ id: 'system', label: '系统', tokens: system });
    if (messageTokens > 0) rows.push({ id: 'messages', label: '消息', tokens: messageTokens });
    if (draftTokens > 0) rows.push({ id: 'draft', label: '草稿', tokens: draftTokens });
    if (limit) rows.push({ id: 'free', label: '剩余', tokens: Math.max(0, limit - used) });
    return { used, limit, level, label, compact, messages, rows };
  }, [catalog, data.nodes, input, node, settings.model, settings.systemPrompt]);

  const navigate = useCallback(
    (nodeId: string, flash?: string) => {
      const n = dataRef.current.nodes[nodeId];
      if (!n) return;
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
    if (!t || compacting || !ensureKey()) return;
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

  const createBranch = (sel: PendingSelection) => {
    const parent = dataRef.current.nodes[dataRef.current.currentNodeId!];
    if (!parent || !ensureKey()) return;
    const id = uid();
    const now = Date.now();
    const child: ChatNode = {
      id,
      sessionId: parent.sessionId,
      parentId: parent.id,
      anchor: { messageId: sel.messageId, start: sel.start, end: sel.end, text: sel.text },
      title: truncate(sel.text, 24),
      messages: [{ id: uid(), role: 'user', content: '', quote: sel.text, status: 'done', createdAt: now }],
      createdAt: now,
    };
    window.getSelection()?.removeAllRanges();
    setAskAt(null);
    stickBottom.current = true;
    commit((d) => ({ ...d, nodes: { ...d.nodes, [id]: child }, currentNodeId: id }));
    generate(id);
  };

  const createProbe = (sel: PendingSelection, note: string) => {
    const parent = dataRef.current.nodes[dataRef.current.currentNodeId!];
    if (!parent || !ensureKey()) return;
    const id = uid();
    const now = Date.now();
    const text = note.trim();
    const child: ChatNode = {
      id,
      sessionId: parent.sessionId,
      parentId: parent.id,
      kind: 'probe',
      anchor: { messageId: sel.messageId, start: sel.start, end: sel.end, text: sel.text },
      title: truncate(text || sel.text, 24),
      messages: [{ id: uid(), role: 'user', content: text, quote: sel.text, status: 'done', createdAt: now }],
      createdAt: now,
    };
    window.getSelection()?.removeAllRanges();
    setProbeDraft(null);
    setAskAt(null);
    setOpenProbeId(id);
    commit((d) => ({ ...d, nodes: { ...d.nodes, [id]: child } }));
    generate(id);
  };

  const sendTo = (nodeId: string, text: string) => {
    const t = text.trim();
    if (!t || !ensureKey() || streaming.has(nodeId)) return;
    const msg: Message = { id: uid(), role: 'user', content: t, status: 'done', createdAt: Date.now() };
    commit((d) => patchNode(d, nodeId, (n) => ({ ...n, messages: [...n.messages, msg] })));
    generate(nodeId);
  };

  const openProbe = (id: string, el?: HTMLElement) => {
    const rect = el?.getBoundingClientRect();
    if (rect) setProbeAnchor({ x: rect.left, y: rect.bottom });
    setOpenProbeId(id);
    setProbeDraft(null);
    setAskAt(null);
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
    const ask = isRoot
      ? '删除整个会话及其所有分支？'
      : n.kind === 'probe'
        ? '删除这条追问？'
        : `删除分支「${n.title}」及其子分支？`;
    if (!confirm(ask)) return;
    const ids = descendantIds(d0.nodes, nodeId);
    ids.forEach((i) => controllers.current.get(i)?.abort());
    if (ids.includes(openProbeId ?? '')) setOpenProbeId(null);
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
      `keepasking-${new Date().toISOString().slice(0, 10)}.json`,
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

  const pickedSelection = (box: HTMLElement, range: Range): PendingSelection | null => {
    const startEl = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement) as HTMLElement | null;
    const endEl = (range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement) as HTMLElement | null;
    if (startEl?.closest('[data-message-id]') !== box || endEl?.closest('[data-message-id]') !== box) return null;
    const off = rangeOffsets(box, range);
    if (!off.text.trim()) return null;
    const rect = range.getBoundingClientRect();
    return { messageId: box.dataset.messageId!, ...off, x: rect.left, y: rect.top };
  };

  const onContextMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const box = target.closest('[data-message-id]') as HTMLElement | null;
    if (!box) return;
    const sel = window.getSelection();
    const existing = sel && !sel.isCollapsed && sel.rangeCount ? pickedSelection(box, sel.getRangeAt(0)) : null;
    if (existing) {
      e.preventDefault();
      setAskAt({ ...existing, x: e.clientX, y: e.clientY });
      return;
    }
    const probeMark = target.closest('mark[data-probe-id]') as HTMLElement | null;
    if (probeMark?.dataset.probeId) {
      e.preventDefault();
      openProbe(probeMark.dataset.probeId, probeMark);
    }
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (askAt) setAskAt(null);
  };

  const isStreaming = node ? streaming.has(node.id) : false;
  const parent = node?.parentId ? data.nodes[node.parentId] : undefined;
  const localModel = /localhost|127\.0\.0\.1/.test(settings.baseUrl);
  const canCompact = !!node && contextUsage.messages.length > 0 && !isStreaming && !compacting && (settings.hasApiKey || localModel);
  const compactReason = compacting
    ? '正在压缩'
    : !settings.hasApiKey && !localModel
      ? '请先在设置中填写 API Key'
      : isStreaming
        ? '请等待回复结束'
        : !node || contextUsage.messages.length === 0
          ? '当前没有可压缩的对话'
          : compactError || '用摘要替换之后发给模型的上下文';

  const runCompact = async () => {
    if (!canCompact || !node) return;
    const nodeId = node.id;
    const uptoMessageId = node.messages[node.messages.length - 1]?.id ?? '';
    const createdAt = Date.now();
    const messages = buildContext(dataRef.current.nodes, nodeId);
    setCompacting(true);
    setCompactError('');
    let summary = '';
    try {
      await streamChat(
        [...messages, { role: 'user', content: COMPACT_ASK }],
        (t) => {
          summary += t;
        },
        new AbortController().signal,
        'compact',
      );
      const text = summary.trim();
      if (!text) throw new Error('模型没有返回摘要');
      commit((d) => patchNode(d, nodeId, (n) => ({ ...n, compact: { summary: text, uptoMessageId, createdAt } })));
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return;
      const msg = e instanceof Error ? e.message : String(e);
      setCompactError(msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setCompacting(false);
    }
  };

  const relocateData = async (dir: string, mode: 'move' | 'switch') => {
    saveGen.current += 1;
    dirty.current = false;
    window.api.data.saveSync(dataRef.current);
    const result = await window.api.data.setDir(dir, mode);
    dataRef.current = result.data;
    settingsRef.current = result.settings;
    setData(result.data);
    setSettings(result.settings);
    applyAppearance(result.settings);
    setShowSettings(false);
  };
  const lastMsg = node?.messages[node.messages.length - 1];

  return (
    <div className={`app ${showTree ? 'with-tree' : ''}`}>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">&gt;</span>追问</div>
        <button className="block" onClick={() => newSession()}>新建对话</button>
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
            设置 {settings.hasApiKey ? '' : <span className="dot-warn">未配置 Key</span>}
          </button>
          <div className="row">
            <button className="sm grow" onClick={exportJson}>导出 JSON</button>
            <button className="sm grow" onClick={importJson}>导入 JSON</button>
          </div>
        </div>
      </aside>

      <main className="chat">
        <header className="chat-head">
          <nav className="crumbs">
            {path.length === 0 && <span>欢迎</span>}
            {path.map((n, i) => (
              <span key={n.id}>
                {i > 0 && <span className="sep">/</span>}
                <button
                  className={`crumb ${n.id === node?.id ? 'cur' : ''}`}
                  onClick={() => navigate(n.id, path[i + 1]?.id)}
                >
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

        <div className={`messages-wrap ${(node?.messages.filter((m) => m.role === 'user').length ?? 0) > 1 ? 'has-rail' : ''}`}>
          <div className="messages" ref={scrollRef} onContextMenu={onContextMenu} onScroll={onScroll}>
            {(!node || node.messages.length === 0) && (
              <div className="welcome">
                <h1>不止线性对话</h1>
                <p className="welcome-slogan">Keep Thinking, Keep Asking</p>
                <p className="welcome-hint">选中文字后右键，可展开分支或追问。</p>
              </div>
            )}
            {node?.messages.map((m) => (
              <MessageView
                key={m.id}
                message={m}
                branches={kids.filter((k) => k.kind !== 'probe' && k.anchor?.messageId === m.id)}
                probes={kids.filter((k) => k.kind === 'probe' && k.anchor?.messageId === m.id)}
                onOpenBranch={navigate}
                onOpenProbe={openProbe}
                onStop={() => stop(node.id)}
                onRegenerate={m.id === lastMsg?.id && m.role === 'assistant' ? () => regenerate(node.id, m.id) : undefined}
              />
            ))}
          </div>
          {node && <TurnRail messages={node.messages} scrollRef={scrollRef} />}
        </div>

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <div className="composer-box">
            <span className="prompt-mark" aria-hidden="true">&gt;</span>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder={node?.parentId ? '在此分支中继续追问…' : '输入问题…'}
              rows={2}
            />
            <div className="composer-bar">
              <div className="composer-tags">
                <div className="composer-tag-wrap" ref={tagRef}>
                  <button
                    type="button"
                    className="composer-tag"
                    data-testid="composer-tag"
                    aria-expanded={pickOpen}
                    aria-label={`${settings.model} ${EFFORT_LABEL[settings.thinkingEffort]}`}
                    onClick={() => {
                      setUsageOpen(false);
                      setPickOpen((v) => !v);
                    }}
                  >
                    <span className="composer-tag-name">{settings.model}</span>
                    <span className={`composer-tag-effort ${settings.thinkingEffort === 'off' ? '' : 'on'}`}>
                      {EFFORT_LABEL[settings.thinkingEffort]}
                    </span>
                  </button>
                  {pickOpen && (
                    <div className="composer-pop">
                      <ComposerPick
                        model={settings.model}
                        models={modelOptions}
                        effort={settings.thinkingEffort}
                        onModel={(model) => patchSettings({ model })}
                        onEffort={(thinkingEffort) => patchSettings({ thinkingEffort })}
                      />
                    </div>
                  )}
                </div>
                <div className="composer-tag-wrap" ref={usageRef}>
                  <button
                    type="button"
                    className="composer-tag context-tag"
                    data-testid="context-usage"
                    data-level={contextUsage.level}
                    aria-expanded={usageOpen}
                    aria-label={`上下文 ${contextUsage.label}`}
                    title={contextUsage.limit ? `估计占用 ${contextUsage.used} / ${contextUsage.limit} tokens` : `估计占用 ${contextUsage.used} tokens。该模型的上下文窗口未知。`}
                    onClick={() => {
                      setPickOpen(false);
                      setUsageOpen((v) => !v);
                    }}
                  >
                    <i />
                    {contextUsage.compact}
                  </button>
                  {usageOpen && (
                    <div className="composer-pop">
                      <ContextUsage
                        used={contextUsage.used}
                        limit={contextUsage.limit}
                        level={contextUsage.level}
                        rows={contextUsage.rows}
                        compacting={compacting}
                        canCompact={canCompact}
                        disabledReason={compactReason}
                        onCompact={() => void runCompact()}
                      />
                    </div>
                  )}
                </div>
              </div>
              {isStreaming ? (
                <button type="button" className="danger" onClick={() => stop(node!.id)}>停止</button>
              ) : (
                <button type="submit" className="primary" disabled={!input.trim() || compacting}>发送</button>
              )}
            </div>
          </div>
        </form>
      </main>

      {showTree && (
        <aside className="tree-panel">
          <div className="tree-head">
            <span>对话树</span>
            {session && (
              <span className="muted">
                {Object.values(data.nodes).filter((n) => n.sessionId === session.id && n.kind !== 'probe').length} 个节点
              </span>
            )}
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
          <div className="tree-tip">选中文字后右键，可展开分支或追问。点击节点切换对话</div>
        </aside>
      )}

      {askAt && (
        <AskMenu
          x={askAt.x}
          y={askAt.y}
          onBranch={() => {
            const sel = askAt;
            setAskAt(null);
            createBranch(sel);
          }}
          onAsk={() => {
            setProbeDraft(askAt);
            setProbeAnchor({ x: askAt.x, y: askAt.y });
            setOpenProbeId(null);
            setAskAt(null);
          }}
          onClose={() => setAskAt(null)}
        />
      )}
      {(probeDraft || (openProbeId && data.nodes[openProbeId])) && (
        <ProbePanel
          anchor={probeAnchor}
          quote={probeDraft?.text || data.nodes[openProbeId!]?.anchor?.text || ''}
          node={openProbeId ? data.nodes[openProbeId] ?? null : null}
          onStart={(note) => probeDraft && createProbe(probeDraft, note)}
          onSend={(text) => openProbeId && sendTo(openProbeId, text)}
          onStop={() => openProbeId && stop(openProbeId)}
          onDelete={() => openProbeId && deleteNode(openProbeId)}
          onClose={() => {
            setOpenProbeId(null);
            setProbeDraft(null);
          }}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onPreview={previewAppearance}
          onRelocate={relocateData}
          onClose={() => {
            applyAppearance(settings);
            setShowSettings(false);
          }}
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
