import { useEffect, useRef, useState } from 'react';
import type { ModelGroup } from '../../../shared/modelCatalog';
import type { ChatRoute, ThinkingEffort } from '../../../shared/types';

export interface ModelPick {
  model: string;
  route: ChatRoute;
  providerId?: string;
}

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
  route: ChatRoute;
  providerId: string;
  groups: ModelGroup[];
  effort: ThinkingEffort;
  onModel: (pick: ModelPick) => void;
  onEffort: (effort: ThinkingEffort) => void;
}

export function ComposerPick({ model, route, providerId, groups, effort, onModel, onEffort }: Props) {
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
          {groups.map((group) => (
            <div className="pick-group" key={group.id}>
              <div className="pick-group-label">{group.label}</div>
              {group.models.length === 0 && <p className="hint">尚未拉取模型</p>}
              {group.models.map((id) => {
                const selected = id === model && group.route === route && (group.route !== 'api' || group.providerId === providerId);
                return (
                  <button
                    type="button"
                    key={`${group.id}:${id}`}
                    role="option"
                    aria-selected={selected}
                    className={selected ? 'active' : ''}
                    onClick={() => {
                      onModel({ model: id, route: group.route, providerId: group.providerId });
                      setOpen(false);
                    }}
                  >
                    {id}
                  </button>
                );
              })}
            </div>
          ))}
          {!groups.length && <p className="hint">还没有模型。在设置里添加提供商或拉取本地 CLI 的模型。</p>}
        </div>
      )}
    </div>
  );
}
