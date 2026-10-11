import type { ApiMessage, ChatNode, Message } from './types';

export function toApiContent(m: Message): string {
  if (m.role === 'user' && m.quote !== undefined) {
    const q = m.quote.split('\n').map((l) => '> ' + l).join('\n');
    const ask = m.content.trim() || '请针对这段内容展开详细解释。';
    return `我想就上文中的这段内容深入展开：\n\n${q}\n\n${ask}`;
  }
  return m.content;
}

/**
 * Build the API message list for a node.
 * Branch context = ancestor context up to (and including) the anchor message, then the branch's own messages.
 */
export function buildContext(
  nodes: Record<string, ChatNode>,
  nodeId: string,
  uptoMessageId?: string,
): ApiMessage[] {
  const node = nodes[nodeId];
  if (!node) return [];
  let prefix: ApiMessage[] = [];
  if (node.parentId && node.anchor) prefix = buildContext(nodes, node.parentId, node.anchor.messageId);
  let msgs = node.messages;
  if (uptoMessageId) {
    const i = msgs.findIndex((m) => m.id === uptoMessageId);
    if (i >= 0) msgs = msgs.slice(0, i + 1);
  }
  const own = msgs
    .filter((m) => m.status !== 'error' && (m.role === 'user' || m.content.trim()))
    .map((m) => ({ role: m.role, content: toApiContent(m) }));
  return [...prefix, ...own];
}

/** Path from root to the node (inclusive) */
export function pathTo(nodes: Record<string, ChatNode>, nodeId: string | null): ChatNode[] {
  const out: ChatNode[] = [];
  let cur = nodeId ? nodes[nodeId] : undefined;
  while (cur) {
    out.unshift(cur);
    cur = cur.parentId ? nodes[cur.parentId] : undefined;
  }
  return out;
}

export function childrenOf(nodes: Record<string, ChatNode>, nodeId: string): ChatNode[] {
  return Object.values(nodes)
    .filter((n) => n.parentId === nodeId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function descendantIds(nodes: Record<string, ChatNode>, nodeId: string): string[] {
  const out = [nodeId];
  for (const c of childrenOf(nodes, nodeId)) out.push(...descendantIds(nodes, c.id));
  return out;
}
