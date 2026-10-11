import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatNode } from '../../../shared/types';
import { childrenOf, pathTo } from '../../../shared/context';
import { truncate } from '../util';

interface Props {
  nodes: Record<string, ChatNode>;
  rootId: string;
  currentId: string | null;
  streamingIds: Set<string>;
  onSelect: (id: string) => void;
}

const W = 150;
const H = 44;
const GX = 28;
const GY = 12;
const PAD = 16;

interface Laid {
  node: ChatNode;
  x: number;
  y: number;
  depth: number;
}

export function TreePanel({ nodes, rootId, currentId, streamingIds, onSelect }: Props) {
  const { laid, edges, width, height } = useMemo(() => {
    const laid: Laid[] = [];
    const pos: Record<string, Laid> = {};
    let leaf = 0;
    const visit = (n: ChatNode, depth: number): number => {
      const kids = childrenOf(nodes, n.id);
      let y: number;
      if (!kids.length) {
        y = leaf++ * (H + GY);
      } else {
        const ys = kids.map((k) => visit(k, depth + 1));
        y = (ys[0] + ys[ys.length - 1]) / 2;
      }
      const l = { node: n, x: depth * (W + GX), y, depth };
      laid.push(l);
      pos[n.id] = l;
      return y;
    };
    const root = nodes[rootId];
    if (root) visit(root, 0);
    const edges = laid
      .filter((l) => l.node.parentId && pos[l.node.parentId])
      .map((l) => ({ from: pos[l.node.parentId!], to: l }));
    const maxX = Math.max(0, ...laid.map((l) => l.x));
    const maxY = Math.max(0, ...laid.map((l) => l.y));
    return { laid, edges, width: maxX + W + PAD * 2, height: maxY + H + PAD * 2 };
  }, [nodes, rootId]);

  const activePath = useMemo(() => new Set(pathTo(nodes, currentId).map((n) => n.id)), [nodes, currentId]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(360);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Zoom out (down to 55%) so wide trees still fit the panel; beyond that, scroll
  const scale = Math.min(1, Math.max(0.55, avail / width));

  // Keep the current node visible
  useEffect(() => {
    const cur = laid.find((l) => l.node.id === currentId);
    const el = wrapRef.current;
    if (!cur || !el) return;
    const cx = (cur.x + PAD) * scale;
    const cy = (cur.y + PAD) * scale;
    if (cx < el.scrollLeft || cx + W > el.scrollLeft + el.clientWidth) el.scrollTo({ left: cx - 20, behavior: 'smooth' });
    if (cy < el.scrollTop || cy + H > el.scrollTop + el.clientHeight) el.scrollTo({ top: cy - 40, behavior: 'smooth' });
  }, [currentId, laid, scale]);

  return (
    <div className="tree-wrap" ref={wrapRef}>
      <svg width={width * scale} height={height * scale} className="tree-svg" data-testid="tree">
        <g transform={`scale(${scale}) translate(${PAD},${PAD})`}>
          {edges.map(({ from, to }) => {
            const x1 = from.x + W;
            const y1 = from.y + H / 2;
            const x2 = to.x;
            const y2 = to.y + H / 2;
            const mx = (x1 + x2) / 2;
            const on = activePath.has(to.node.id);
            return (
              <path
                key={to.node.id}
                d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                className={`tree-edge ${on ? 'on' : ''}`}
              />
            );
          })}
          {laid.map(({ node, x, y }) => {
            const cur = node.id === currentId;
            const on = activePath.has(node.id);
            const streaming = streamingIds.has(node.id);
            const count = node.messages.length;
            return (
              <g
                key={node.id}
                transform={`translate(${x},${y})`}
                className={`tree-node ${cur ? 'cur' : ''} ${on ? 'on' : ''}`}
                onClick={() => onSelect(node.id)}
                data-node-id={node.id}
              >
                <title>{node.anchor ? `「${node.anchor.text}」` : node.title}</title>
                <rect width={W} height={H} rx={10} />
                <text x={12} y={18} className="tree-title">
                  {node.parentId ? '🌿 ' : '🌳 '}
                  {truncate(node.title || '新对话', 11)}
                </text>
                <text x={12} y={34} className="tree-sub">
                  {count} 条消息{node.anchor ? ` · 「${truncate(node.anchor.text, 6)}」` : ''}
                </text>
                {streaming && <circle cx={W - 12} cy={12} r={4} className="tree-pulse" />}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
