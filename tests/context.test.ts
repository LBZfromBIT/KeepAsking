import { describe, expect, it } from 'vitest';
import { buildContext, childrenOf, descendantIds, pathTo, toApiContent } from '../src/shared/context';
import type { ChatNode, Message } from '../src/shared/types';

const msg = (id: string, role: Message['role'], content: string, extra: Partial<Message> = {}): Message => ({
  id,
  role,
  content,
  status: 'done',
  createdAt: 0,
  ...extra,
});

function fixture(): Record<string, ChatNode> {
  const root: ChatNode = {
    id: 'root',
    sessionId: 's',
    parentId: null,
    title: 'root',
    createdAt: 1,
    messages: [msg('u1', 'user', 'Q1'), msg('a1', 'assistant', 'A1 包含 注意力'), msg('u2', 'user', 'Q2'), msg('a2', 'assistant', 'A2')],
  };
  const b1: ChatNode = {
    id: 'b1',
    sessionId: 's',
    parentId: 'root',
    anchor: { messageId: 'a1', start: 5, end: 8, text: '注意力' },
    title: '注意力',
    createdAt: 2,
    messages: [msg('bu1', 'user', '', { quote: '注意力' }), msg('ba1', 'assistant', 'B1 关于 键向量')],
  };
  const b2: ChatNode = {
    id: 'b2',
    sessionId: 's',
    parentId: 'b1',
    anchor: { messageId: 'ba1', start: 6, end: 9, text: '键向量' },
    title: '键向量',
    createdAt: 3,
    messages: [msg('cu1', 'user', '举个例子', { quote: '键向量' })],
  };
  const b3: ChatNode = { ...b1, id: 'b3', createdAt: 4, anchor: { ...b1.anchor!, messageId: 'a2' }, messages: [] };
  return { root, b1, b2, b3 };
}

describe('toApiContent', () => {
  it('passes plain messages through', () => {
    expect(toApiContent(msg('x', 'user', 'hi'))).toBe('hi');
  });
  it('wraps the quote and uses a default question when empty', () => {
    const c = toApiContent(msg('x', 'user', '', { quote: 'line1\nline2' }));
    expect(c).toContain('> line1\n> line2');
    expect(c).toContain('请针对这段内容展开详细解释');
  });
  it('includes the follow-up question', () => {
    expect(toApiContent(msg('x', 'user', '为什么？', { quote: 'q' }))).toMatch(/> q\n\n为什么？$/);
  });
});

describe('buildContext', () => {
  it('root returns its own history', () => {
    expect(buildContext(fixture(), 'root').map((m) => m.content)).toEqual(['Q1', 'A1 包含 注意力', 'Q2', 'A2']);
  });

  it('branch includes ancestor history only up to the anchor message', () => {
    const ctx = buildContext(fixture(), 'b1');
    expect(ctx.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(ctx[1].content).toBe('A1 包含 注意力');
    expect(ctx[2].content).toContain('> 注意力');
    expect(ctx.some((m) => m.content === 'Q2')).toBe(false);
  });

  it('nested branch chains through every ancestor', () => {
    const ctx = buildContext(fixture(), 'b2');
    expect(ctx.map((m) => m.content.slice(0, 2))).toEqual(['Q1', 'A1', '我想', 'B1', '我想']);
    expect(ctx[4].content).toContain('举个例子');
  });

  it('skips errored and empty assistant messages', () => {
    const n = fixture();
    n.root.messages.push(msg('e', 'assistant', 'oops', { status: 'error' }), msg('s', 'assistant', '', { status: 'streaming' }));
    expect(buildContext(n, 'root')).toHaveLength(4);
  });

  it('returns [] for unknown nodes', () => {
    expect(buildContext(fixture(), 'nope')).toEqual([]);
  });
});

describe('tree helpers', () => {
  it('pathTo walks from root', () => {
    expect(pathTo(fixture(), 'b2').map((n) => n.id)).toEqual(['root', 'b1', 'b2']);
    expect(pathTo(fixture(), null)).toEqual([]);
  });
  it('childrenOf is ordered by creation time', () => {
    expect(childrenOf(fixture(), 'root').map((n) => n.id)).toEqual(['b1', 'b3']);
  });
  it('descendantIds includes the node and all descendants', () => {
    expect(descendantIds(fixture(), 'root').sort()).toEqual(['b1', 'b2', 'b3', 'root']);
    expect(descendantIds(fixture(), 'b1').sort()).toEqual(['b1', 'b2']);
  });
});
