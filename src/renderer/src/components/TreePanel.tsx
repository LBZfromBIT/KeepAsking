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
/** Horizontal gap between sibling subtrees. */
const GAP_X = 22;
/** Vertical gap between a node and its children. Depth grows downward. */
const GAP_Y = 40;
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
      const kids = childrenOf(nodes, n.id).filter((k) => k.kind !== 'probe');
      let x: number;
      if (!kids.length) {
        x = leaf++ * (W + GAP_X);
      } else {
        const xs = kids.map((k) => visit(k, depth + 1));
        x = (xs[0] + xs[xs.length - 1]) / 2;
      }
      const l = { node: n, x, y: depth * (H + GAP_Y), depth };
      laid.push(l);
      pos[n.id] = l;
      return x;
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
  // Shrink (down to 55%) so a wide row of siblings still fits the panel; beyond that, scroll
  const scale = Math.min(1, Math.max(0.55, avail / width));
  // Center a tree that is narrower than the panel. A wider one stays left-aligned and scrolls.
  const offsetX = Math.max(0, (avail - width * scale) / 2);

  // Keep the current node visible
  useEffect(() => {
    const cur = laid.find((l) => l.node.id === currentId);
    const el = wrapRef.current;
    if (!cur || !el) return;
    const cx = offsetX + (cur.x + PAD) * scale;
    const cy = (cur.y + PAD) * scale;
    const nodeW = W * scale;
    const nodeH = H * scale;
    const next: ScrollToOptions = { behavior: 'smooth' };
    let moved = false;
    if (cx < el.scrollLeft || cx + nodeW > el.scrollLeft + el.clientWidth) {
      next.left = Math.max(0, cx - 20);
      moved = true;
    }
    if (cy < el.scrollTop || cy + nodeH > el.scrollTop + el.clientHeight) {
      next.top = Math.max(0, cy - 40);
      moved = true;
    }
    if (moved) el.scrollTo(next);
  }, [currentId, laid, scale, offsetX]);

  return (
    <div className="tree-wrap" ref={wrapRef}>
      <svg width={Math.max(width * scale, avail)} height={height * scale} className="tree-svg" data-testid="tree">
        <g transform={`translate(${offsetX},0) scale(${scale}) translate(${PAD},${PAD})`}>
          {edges.map(({ from, to }) => {
            const x1 = from.x + W / 2;
            const y1 = from.y + H;
            const x2 = to.x + W / 2;
            const y2 = to.y;
            const my = (y1 + y2) / 2;
            const on = activePath.has(to.node.id);
            return (
              <path
                key={to.node.id}
                d={`M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`}
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
                data-root={node.parentId ? undefined : 'true'}
              >
                <title>{node.anchor ? `「${node.anchor.text}」` : node.title}</title>
                <rect width={W} height={H} rx={10} />
                <text x={12} y={18} className="tree-title">
                  {truncate(node.title || '新对话', 12)}
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
