import { useLayoutEffect, useState, type RefObject } from 'react';
import type { Message } from '../../../shared/types';
import { truncate } from '../util';

interface Turn {
  id: string;
  user: string;
  assistant: string;
}

interface Props {
  messages: Message[];
  scrollRef: RefObject<HTMLDivElement | null>;
}

export function TurnRail({ messages, scrollRef }: Props) {
  const turns: Turn[] = [];
  messages.forEach((m, i) => {
    if (m.role !== 'user') return;
    const next = messages[i + 1];
    turns.push({
      id: m.id,
      user: (m.content.trim() || m.quote || '（空）').replace(/\s+/g, ' '),
      assistant: next?.role === 'assistant' ? next.content.replace(/\s+/g, ' ').trim() : '',
    });
  });
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const [hover, setHover] = useState<{ id: string; top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || turns.length < 2) return;
    const measure = () => {
      const total = scroller.scrollHeight || 1;
      const next: Record<string, number> = {};
      scroller.querySelectorAll<HTMLElement>('[data-turn-id]').forEach((el) => {
        const id = el.dataset.turnId;
        if (!id) return;
        const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
        next[id] = top / total;
      });
      setRatios(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [scrollRef, messages]);

  if (turns.length < 2) return null;
  const hovered = hover ? turns.find((t) => t.id === hover.id) : undefined;

  return (
    <div className="turn-rail" data-testid="turn-rail">
      {turns.map((t) => (
        <button
          key={t.id}
          type="button"
          className="turn-tick"
          style={{ top: `${(ratios[t.id] ?? 0) * 100}%` }}
          aria-label={`定位到：${truncate(t.user, 40)}`}
          onMouseEnter={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setHover({ id: t.id, top: r.top, left: r.left });
          }}
          onMouseLeave={() => setHover((cur) => (cur?.id === t.id ? null : cur))}
          onClick={() => {
            const scroller = scrollRef.current;
            const el = scroller?.querySelector<HTMLElement>(`[data-turn-id="${t.id}"]`);
            if (!scroller || !el) return;
            const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
            scroller.scrollTop = Math.max(0, top - 12);
            el.classList.add('turn-flash');
            window.setTimeout(() => el.classList.remove('turn-flash'), 1200);
          }}
        >
          <i />
        </button>
      ))}
      {hovered && hover && (
        <div
          className="turn-preview"
          style={{
            top: Math.min(Math.max(8, hover.top - 12), window.innerHeight - 88),
            left: Math.max(8, hover.left - 236),
          }}
        >
          <div className="turn-preview-user">{truncate(hovered.user, 80)}</div>
          {hovered.assistant && <div className="turn-preview-ai">{truncate(hovered.assistant, 80)}</div>}
        </div>
      )}
    </div>
  );
}
