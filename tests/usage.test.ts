import { describe, expect, it } from 'vitest';
import { compactContent } from '../src/shared/context';
import { contextBreakdown, estimateContextTokens, estimateTokens, formatTokenCount, resolveContextWindow } from '../src/shared/usage';

describe('context usage', () => {
  it('counts CJK text as heavier than the same number of ASCII characters', () => {
    expect(estimateTokens('你好')).toBeGreaterThan(estimateTokens('ab'));
  });

  it('includes the system prompt and the draft message', () => {
    const base = estimateContextTokens('你是助手', []);
    const withDraft = estimateContextTokens('你是助手', [{ content: '再问一句' }]);
    expect(withDraft).toBeGreaterThan(base);
  });

  it('formats counts and resolves a window', () => {
    expect(formatTokenCount(999)).toBe('999');
    expect(formatTokenCount(1800)).toBe('1.8k');
    expect(formatTokenCount(128000)).toBe('128k');
    expect(resolveContextWindow('gpt-4o-mini', null)).toBe(128000);
    expect(resolveContextWindow('custom-model', 32000)).toBe(32000);
    expect(resolveContextWindow('custom-model', null)).toBeNull();
  });

  it('itemizes system text, messages, a summary, and the draft', () => {
    const messages = [
      { role: 'user' as const, content: '你好' },
      { role: 'assistant' as const, content: '回答' },
      { role: 'user' as const, content: compactContent('摘要正文') },
    ];
    const { parts, used } = contextBreakdown('系统', messages, '草稿');
    expect(parts.map((p) => p.label)).toEqual(['系统提示', '你', '助手', '摘要', '草稿']);
    expect(parts[3].preview).toBe('摘要正文');
    expect(used).toBe(estimateContextTokens('系统', [...messages, { content: '草稿' }]));
  });
});
