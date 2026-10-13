import { useEffect, useRef, useState } from 'react';
import type { ThinkingEffort } from '../../../shared/types';

const EFFORTS: ThinkingEffort[] = ['off', 'low', 'medium', 'high'];
const LABELS = ['关', '低', '中', '高'];

export const EFFORT_LABEL: Record<ThinkingEffort, string> = {
  off: '关',
  low: '低',
  medium: '中',
  high: '高',
};

interface Props {
  model: string;
  models: string[];
  effort: ThinkingEffort;
  onModel: (id: string) => void;
  onEffort: (effort: ThinkingEffort) => void;
}

export function ComposerPick({ model, models, effort, onModel, onEffort }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const index = Math.max(0, EFFORTS.indexOf(effort));
  const at = (index / (EFFORTS.length - 1)) * 100;

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  return (
    <div className={`pick ${effort === 'off' ? 'is-off' : ''}`} ref={root} data-effort={effort}>
      <div className="pick-head">
        <div className="pick-copy">
          <span className={`pick-effort ${effort === 'off' ? 'off' : ''}`}>{LABELS[index]}</span>
          <button
            type="button"
            className="pick-model"
            data-testid="composer-model"
            title={model}
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span>{model || '选择模型'}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
      <div className="pick-slider">
        <div className="pick-track" aria-hidden="true">
          <div className="pick-fill" style={{ width: `${at}%` }} />
        </div>
        {EFFORTS.map((id, i) => (
          <span
            key={id}
            className={`pick-dot ${i < index ? 'passed' : ''}`}
            style={{ left: `${(i / (EFFORTS.length - 1)) * 100}%`, opacity: i === index ? 0 : 1 }}
            aria-hidden="true"
          />
        ))}
        <span className="pick-thumb" style={{ left: `${at}%` }} aria-hidden="true" />
        <input
          className="pick-range"
          data-testid="composer-effort"
          type="range"
          min={0}
          max={EFFORTS.length - 1}
          step={1}
          value={index}
          aria-label="思考力度"
          aria-valuetext={LABELS[index]}
          onChange={(e) => onEffort(EFFORTS[Number(e.target.value)] ?? 'off')}
        />
      </div>
      {open && (
        <div className="pick-menu" role="listbox" aria-label="模型" data-testid="composer-model-list">
          {models.map((id) => (
            <button
              type="button"
              key={id}
              role="option"
              aria-selected={id === model}
              className={id === model ? 'active' : ''}
              onClick={() => {
                onModel(id);
                setOpen(false);
              }}
            >
              {id}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
