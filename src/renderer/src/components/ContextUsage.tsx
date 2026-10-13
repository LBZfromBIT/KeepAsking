export interface UsageRow {
  id: string;
  label: string;
  tokens: number;
}

interface Props {
  used: number;
  limit: number | null;
  level: 'ok' | 'warn' | 'hot' | 'none';
  rows: UsageRow[];
  compacting: boolean;
  canCompact: boolean;
  disabledReason: string;
  onCompact: () => void;
}

/** Panel counts keep a second decimal under 100k, so 12.66k stays distinct from the compact tag. */
function formatPanelCount(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v < 1000) return String(v);
  const k = v / 1000;
  if (k >= 100) return `${Math.round(k)}k`;
  return `${k.toFixed(2).replace(/\.?0+$/, '')}k`;
}

export function ContextUsage({ used, limit, level, rows, compacting, canCompact, disabledReason, onCompact }: Props) {
  const ratio = limit ? Math.min(1, used / limit) : 0;
  const pct = limit ? Math.round((used / limit) * 100) : null;
  const value = limit ? `${formatPanelCount(used)} / ${formatPanelCount(limit)} (${pct}%)` : formatPanelCount(used);
  return (
    <div className="usage-card" data-testid="context-usage-panel">
      <div className="usage-head">
        <span>上下文占用</span>
        <span className="usage-total">{value}</span>
      </div>
      <div
        className="usage-track"
        role="meter"
        aria-label={`上下文占用 ${value}`}
        aria-valuemin={0}
        aria-valuemax={limit ?? 0}
        aria-valuenow={limit ? Math.min(used, limit) : 0}
      >
        <div className="usage-fill" data-level={level} style={{ width: `${ratio * 100}%` }} />
      </div>
      <button type="button" className="usage-compact" disabled={!canCompact} title={disabledReason} onClick={onCompact}>
        {compacting ? '压缩中…' : '压缩上下文'}
      </button>
      {rows.length > 0 && (
        <div className="usage-section">
          <div className="usage-section-label">本窗口</div>
          {rows.map((row) => (
            <div className="usage-row" key={row.id}>
              <span>{row.label}</span>
              <span className="usage-num">{formatPanelCount(row.tokens)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
