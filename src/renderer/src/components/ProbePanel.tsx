import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChatNode } from '../../../shared/types';
import { renderMarkdown } from '../markdown';
import { truncate } from '../util';
import { Thinking } from './Thinking';

interface Anchor {
  x: number;
  y: number;
}

interface Props {
  anchor: Anchor;
  quote: string;
  node: ChatNode | null;
  onStart: (note: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onDelete: () => void;
  onClose: () => void;
}

function MiniMarkdown({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderMarkdown(text), [text]);
  useLayoutEffect(() => {
    if (ref.current) ref.current.innerHTML = html;
  }, [html]);
  return <div className="probe-md markdown" ref={ref} />;
}

const PANEL_W = 560;
const PANEL_H = 640;

function placePanel(anchor: Anchor) {
  return {
    x: Math.min(Math.max(8, anchor.x), Math.max(8, window.innerWidth - PANEL_W - 8)),
    y: Math.min(Math.max(8, anchor.y + 8), Math.max(8, window.innerHeight - PANEL_H - 8)),
  };
}

export function ProbePanel({ anchor, quote, node, onStart, onSend, onStop, onDelete, onClose }: Props) {
  const [note, setNote] = useState('');
  const [reply, setReply] = useState('');
  const [pos, setPos] = useState(() => placePanel(anchor));
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const dragListeners = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(null);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  useEffect(() => {
    noteRef.current?.focus();
  }, []);

  useEffect(() => {
    setPos(placePanel(anchor));
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    return () => {
      if (!dragListeners.current) return;
      window.removeEventListener('mousemove', dragListeners.current.move);
      window.removeEventListener('mouseup', dragListeners.current.up);
    };
  }, []);

  const onDragStart = (e: React.MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    const move = (ev: MouseEvent) => {
      const width = ref.current?.offsetWidth ?? PANEL_W;
      setPos({
        x: Math.min(Math.max(8, ev.clientX - dx), Math.max(8, window.innerWidth - width - 8)),
        y: Math.min(Math.max(8, ev.clientY - dy), Math.max(8, window.innerHeight - 48)),
      });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      dragListeners.current = null;
    };
    dragListeners.current = { move, up };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [node?.messages]);

  const streaming = node?.messages.some((m) => m.status === 'streaming') ?? false;

  return (
    <div
      className={`probe-panel${node ? ' open' : ''}`}
      data-testid="probe-panel"
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="probe-head" onMouseDown={onDragStart}>
        <span>追问</span>
        <span className="probe-head-actions">
          {node && (
            <button type="button" className="link" onClick={onDelete}>
              删除
            </button>
          )}
          <button type="button" className="link" data-testid="probe-close" onClick={onClose}>
            关闭
          </button>
        </span>
      </div>
      <div className="probe-quote">「{truncate(quote, 80)}」</div>
      {node ? (
        <>
          <div className="probe-list" ref={listRef}>
            {node.messages.map((m) => {
              if (m.role === 'user' && !m.content.trim()) return null;
              const waiting = m.role === 'assistant' && m.status === 'streaming' && !m.content;
              return (
                <div key={m.id} className={`probe-msg probe-${m.role}`}>
                  {m.role === 'user' && <div className="probe-user">{m.content}</div>}
                  {m.role === 'assistant' && waiting && <Thinking />}
                  {m.role === 'assistant' && m.content && <MiniMarkdown text={m.content} />}
                  {m.status === 'error' && <div className="msg-error">{m.error || '请求失败'}</div>}
                </div>
              );
            })}
          </div>
          <form
            className="probe-compose"
            onSubmit={(e) => {
              e.preventDefault();
              const text = reply.trim();
              if (!text || streaming) return;
              setReply('');
              onSend(text);
            }}
          >
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="继续说…"
              disabled={streaming}
            />
            {streaming ? (
              <button type="button" className="danger sm" onClick={onStop}>
                停止
              </button>
            ) : (
              <button type="submit" className="primary sm" disabled={!reply.trim()}>
                发送
              </button>
            )}
          </form>
        </>
      ) : (
        <form
          className="probe-compose"
          onSubmit={(e) => {
            e.preventDefault();
            onStart(note);
          }}
        >
          <textarea
            ref={noteRef}
            data-testid="probe-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="补充说明，可以留空"
          />
          <button type="submit" className="primary sm" data-testid="probe-start">
            开始
          </button>
        </form>
      )}
    </div>
  );
}

export function AskMenu({
  x,
  y,
  onBranch,
  onAsk,
  onClose,
}: {
  x: number;
  y: number;
  onBranch: () => void;
  onAsk: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);
  const left = Math.min(Math.max(8, x), window.innerWidth - 210);
  const top = Math.min(Math.max(8, y), window.innerHeight - 48);
  return (
    <div className="branch-pop" data-testid="ask-menu" ref={ref} style={{ left, top }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="branch-pop-row">
        <button type="button" className="primary sm" onClick={onBranch} title="基于选中内容开启分支对话">
          展开分支
        </button>
        <button type="button" className="sm" data-testid="ask-open" onClick={onAsk}>
          追问
        </button>
      </div>
    </div>
  );
}
