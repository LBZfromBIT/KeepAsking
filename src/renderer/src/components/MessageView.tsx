import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import type { ChatNode, Message } from '../../../shared/types';
import { renderMarkdown, wrapRange } from '../markdown';
import { truncate } from '../util';
import { Thinking } from './Thinking';

interface Props {
  message: Message;
  branches: ChatNode[]; // child branches anchored in this message
  probes: ChatNode[]; // inline follow-ups anchored in this message
  onOpenBranch: (nodeId: string) => void;
  onOpenProbe: (nodeId: string, el: HTMLElement) => void;
  onRegenerate?: () => void;
  onStop?: () => void;
}

function MessageViewImpl({ message, branches, probes, onOpenBranch, onOpenProbe, onRegenerate, onStop }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderMarkdown(message.content || ''), [message.content]);
  const anchorKey = [...branches, ...probes].map((b) => `${b.kind ?? 'branch'}:${b.id}:${b.anchor!.start}-${b.anchor!.end}`).join('|');

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = html;
    const marks = [
      ...branches.map((b) => ({
        id: b.id,
        start: b.anchor!.start,
        end: b.anchor!.end,
        className: 'branch-mark',
        attr: 'data-branch-id',
        title: `分支：${b.title}（点击进入）`,
      })),
      ...probes.map((b) => ({
        id: b.id,
        start: b.anchor!.start,
        end: b.anchor!.end,
        className: 'probe-mark',
        attr: 'data-probe-id',
        title: `追问：${b.title}（点击查看）`,
      })),
    ].sort((a, b) => b.end - b.start - (a.end - a.start));
    for (const m of marks) {
      wrapRange(el, m.start, m.end, { class: m.className, [m.attr]: m.id, title: m.title });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, anchorKey]);

  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('mark[data-probe-id]')) e.stopPropagation();
  };

  const onClick = (e: React.MouseEvent) => {
    if (window.getSelection()?.toString()) return;
    const probe = (e.target as HTMLElement).closest('mark[data-probe-id]') as HTMLElement | null;
    if (probe?.dataset.probeId) {
      onOpenProbe(probe.dataset.probeId, probe);
      return;
    }
    const mark = (e.target as HTMLElement).closest('mark[data-branch-id]') as HTMLElement | null;
    if (mark?.dataset.branchId) onOpenBranch(mark.dataset.branchId);
  };

  const isUser = message.role === 'user';
  return (
    <div className={`msg msg-${message.role}`} data-turn-id={isUser ? message.id : undefined}>
      <div className="msg-main">
        <div className="msg-kicker">{isUser ? '你' : '助手'}</div>
        {message.quote !== undefined && (
          <div className="msg-quote" title={message.quote}>
            <span className="msg-quote-label">引用</span>
            {truncate(message.quote, 160)}
          </div>
        )}
        {isUser && !message.content.trim() && message.quote !== undefined ? (
          <div className="msg-body msg-muted">请针对这段内容展开详细解释</div>
        ) : (
          <div
            className="msg-body markdown"
            data-message-id={message.id}
            ref={ref}
            onMouseDown={onMouseDown}
            onClick={onClick}
          />
        )}
        {message.status === 'streaming' && !message.content && <Thinking />}
        {message.status === 'error' && <div className="msg-error">{message.error || '请求失败'}</div>}
        <div className="msg-actions">
          {branches.length > 0 && (
            <span className="branch-chips">
              {branches.map((b) => (
                <button key={b.id} className="chip" onClick={() => onOpenBranch(b.id)} title={b.anchor?.text}>
                  ↳ {truncate(b.title, 18)}
                </button>
              ))}
            </span>
          )}
          {!isUser && message.status === 'streaming' && onStop && (
            <button className="link" onClick={onStop}>停止</button>
          )}
          {!isUser && message.status !== 'streaming' && (
            <>
              <button className="link" onClick={() => navigator.clipboard?.writeText(message.content)}>复制</button>
              {onRegenerate && <button className="link" onClick={onRegenerate}>重新生成</button>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export const MessageView = memo(MessageViewImpl);
