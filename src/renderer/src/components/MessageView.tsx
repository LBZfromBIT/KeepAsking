import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import type { ChatNode, Message } from '../../../shared/types';
import { renderMarkdown, wrapRange } from '../markdown';
import { truncate } from '../util';

interface Props {
  message: Message;
  branches: ChatNode[]; // child nodes anchored in this message
  onOpenBranch: (nodeId: string) => void;
  onRegenerate?: () => void;
  onStop?: () => void;
}

function MessageViewImpl({ message, branches, onOpenBranch, onRegenerate, onStop }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderMarkdown(message.content || ''), [message.content]);
  const anchorKey = branches.map((b) => `${b.id}:${b.anchor!.start}-${b.anchor!.end}`).join('|');

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = html;
    // Apply larger ranges first so nested marks look sensible
    const sorted = [...branches].sort(
      (a, b) => b.anchor!.end - b.anchor!.start - (a.anchor!.end - a.anchor!.start),
    );
    for (const b of sorted) {
      wrapRange(el, b.anchor!.start, b.anchor!.end, {
        class: 'branch-mark',
        'data-branch-id': b.id,
        title: `分支：${b.title}（点击进入）`,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, anchorKey]);

  const onClick = (e: React.MouseEvent) => {
    const mark = (e.target as HTMLElement).closest('mark[data-branch-id]') as HTMLElement | null;
    if (mark && !window.getSelection()?.toString()) onOpenBranch(mark.dataset.branchId!);
  };

  const isUser = message.role === 'user';
  return (
    <div className={`msg msg-${message.role}`}>
      <div className="msg-avatar">{isUser ? '你' : 'AI'}</div>
      <div className="msg-main">
        {message.quote !== undefined && (
          <div className="msg-quote" title={message.quote}>
            <span className="msg-quote-label">聚焦</span>
            {truncate(message.quote, 160)}
          </div>
        )}
        {isUser && !message.content.trim() && message.quote !== undefined ? (
          <div className="msg-body msg-muted">（请针对这段内容展开详细解释）</div>
        ) : (
          <div
            className="msg-body markdown"
            data-message-id={message.id}
            ref={ref}
            onClick={onClick}
          />
        )}
        {message.status === 'streaming' && !message.content && <div className="typing"><i /><i /><i /></div>}
        {message.status === 'error' && <div className="msg-error">⚠️ {message.error || '请求失败'}</div>}
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
