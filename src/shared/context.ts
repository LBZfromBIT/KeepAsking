import type { ApiMessage, ChatNode, FileAttachment, Message } from './types';

export const COMPACT_SYSTEM = '你负责压缩对话上下文。只输出摘要正文，不要标题、寒暄或代码围栏。';

export const COMPACT_ASK = `请将以上全部对话压缩成一份摘要，供后续轮次代替原文使用。
保留用户目标、关键事实、已做决定、约束、未解决的问题和重要原话。
使用与用户相同的语言，按时间顺序写得简洁。`;

export const COMPACT_PREFIX = '此前对话已压缩为以下摘要，请据此继续，不要复述摘要：\n\n';

export function compactContent(summary: string): string {
  return COMPACT_PREFIX + summary.trim();
}

function fileBlock(files: FileAttachment[] | undefined): string {
  if (!files?.length) return '';
  return files.map((file) => `【附件：${file.name}】\n${file.text}`).join('\n\n');
}

export function toApiContent(m: Message): string {
  const files = fileBlock(m.files);
  if (m.role === 'user' && m.quote !== undefined) {
    const q = m.quote.split('\n').map((l) => '> ' + l).join('\n');
    const ask = m.content.trim() || '请针对这段内容展开详细解释。';
    const body = `我想就上文中的这段内容深入展开：\n\n${q}\n\n${ask}`;
    return files ? `${body}\n\n${files}` : body;
  }
  if (!m.content.trim() && files) return files;
  return files ? `${m.content.trim()}\n\n${files}` : m.content;
}

function toApi(msgs: Message[]): ApiMessage[] {
  return msgs
    .filter((m) => m.status !== 'error' && (m.role === 'user' || m.content.trim()))
    .map((m) => ({ role: m.role, content: toApiContent(m) }));
}

/** Messages the summary does not cover. A missing cutoff keeps anything written after the compact. */
function messagesAfterCompact(node: ChatNode): Message[] {
  const c = node.compact;
  if (!c || typeof c.summary !== 'string' || !c.summary.trim()) return node.messages;
  if (c.uptoMessageId) {
    const idx = node.messages.findIndex((m) => m.id === c.uptoMessageId);
    if (idx >= 0) return node.messages.slice(idx + 1);
  }
  const at = Number(c.createdAt) || 0;
  return node.messages.filter((m) => m.createdAt > at);
}

/**
 * Build the API message list for a node.
 * Branch context = ancestor context up to (and including) the anchor message, then the branch's own messages.
 * A compact summary replaces that list only for the compacted node itself. Ancestor lookups keep the original text,
 * so existing branches still quote the passage they were opened from.
 */
export function buildContext(
  nodes: Record<string, ChatNode>,
  nodeId: string,
  uptoMessageId?: string,
): ApiMessage[] {
  const node = nodes[nodeId];
  if (!node) return [];
  const summary = !uptoMessageId && node.compact?.summary?.trim() ? node.compact.summary.trim() : '';
  if (summary) {
    return [{ role: 'user', content: compactContent(summary) }, ...toApi(messagesAfterCompact(node))];
  }
  let prefix: ApiMessage[] = [];
  if (node.parentId && node.anchor) prefix = buildContext(nodes, node.parentId, node.anchor.messageId);
  let msgs = node.messages;
  if (uptoMessageId) {
    const i = msgs.findIndex((m) => m.id === uptoMessageId);
    if (i >= 0) msgs = msgs.slice(0, i + 1);
  }
  return [...prefix, ...toApi(msgs)];
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
