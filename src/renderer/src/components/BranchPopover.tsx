import { useEffect, useRef, useState } from 'react';
import { truncate } from '../util';

export interface PendingSelection {
  messageId: string;
  start: number;
  end: number;
  text: string;
  x: number;
  y: number;
}

interface Props {
  sel: PendingSelection;
  onBranch: (question: string) => void;
  onClose: () => void;
}

export function BranchPopover({ sel, onBranch, onClose }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const left = Math.min(Math.max(8, sel.x), window.innerWidth - (expanded ? 340 : 230));
  const top = Math.max(8, sel.y - (expanded ? 96 : 46));

  return (
    <div className="branch-pop" ref={ref} style={{ left, top }} onMouseDown={(e) => e.stopPropagation()}>
      {!expanded ? (
        <div className="branch-pop-row">
          <button className="primary sm" onClick={() => onBranch('')} title="基于选中内容开启分支对话">
            🌿 展开分支
          </button>
          <button className="sm" onClick={() => setExpanded(true)}>✏️ 追问…</button>
        </div>
      ) : (
        <form
          className="branch-pop-form"
          onSubmit={(e) => {
            e.preventDefault();
            onBranch(q);
          }}
        >
          <div className="branch-pop-quote">「{truncate(sel.text, 40)}」</div>
          <div className="branch-pop-row">
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="针对选中内容提问（可留空）"
            />
            <button className="primary sm" type="submit">展开</button>
          </div>
        </form>
      )}
    </div>
  );
}
