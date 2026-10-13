import { COMPACT_PREFIX } from './context';
import type { ApiMessage } from './types';

export interface ContextPart {
  id: string;
  kind: 'system' | 'summary' | 'user' | 'assistant' | 'draft';
  label: string;
  preview: string;
  tokens: number;
}

function previewOf(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 48 ? `${line.slice(0, 48)}…` : line;
}

/** Itemized estimate. The total matches estimateContextTokens for the same prompt, messages, and draft. */
export function contextBreakdown(
  systemPrompt: string,
  messages: Pick<ApiMessage, 'role' | 'content'>[],
  draft: string,
): { parts: ContextPart[]; used: number } {
  const parts: ContextPart[] = [];
  if (systemPrompt) {
    parts.push({
      id: 'system',
      kind: 'system',
      label: '系统提示',
      preview: previewOf(systemPrompt),
      tokens: estimateTokens(systemPrompt) + 4,
    });
  }
  messages.forEach((m, i) => {
    const summary = m.role === 'user' && m.content.startsWith(COMPACT_PREFIX);
    parts.push({
      id: `m${i}`,
      kind: summary ? 'summary' : m.role,
      label: summary ? '摘要' : m.role === 'user' ? '你' : '助手',
      preview: previewOf(summary ? m.content.slice(COMPACT_PREFIX.length) : m.content),
      tokens: estimateTokens(m.content) + 4,
    });
  });
  const pending = draft.trim();
  if (pending) {
    parts.push({
      id: 'draft',
      kind: 'draft',
      label: '草稿',
      preview: previewOf(pending),
      tokens: estimateTokens(pending) + 4,
    });
  }
  return { parts, used: parts.reduce((n, p) => n + p.tokens, 0) };
}

/** Rough token count. ASCII is about 4 characters per token; a CJK character is about 1.5. */
export function estimateTokens(text: string): number {
  let n = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c <= 0x7f) n += 0.25;
    else if (c >= 0x4e00 && c <= 0x9fff) n += 1.5;
    else if (c > 0xff) n += 1.2;
    else n += 0.5;
  }
  return Math.ceil(n);
}

/** Tokens the next request will occupy: system prompt, messages, and chat framing. */
export function estimateContextTokens(systemPrompt: string, messages: Pick<ApiMessage, 'content'>[]): number {
  let n = 0;
  if (systemPrompt) n += estimateTokens(systemPrompt) + 4;
  for (const m of messages) n += estimateTokens(m.content) + 4;
  return n;
}

const KNOWN_WINDOWS: { re: RegExp; tokens: number }[] = [
  { re: /gpt-4\.1/i, tokens: 1_047_576 },
  { re: /gpt-4o/i, tokens: 128_000 },
  { re: /gpt-4-turbo|gpt-4-1106|gpt-4-0125/i, tokens: 128_000 },
  { re: /gpt-3\.5/i, tokens: 16_385 },
  { re: /\bo[134](?:-|$)/i, tokens: 200_000 },
  { re: /claude/i, tokens: 200_000 },
  { re: /deepseek/i, tokens: 128_000 },
  { re: /grok/i, tokens: 131_072 },
  { re: /gemini-(?:1\.5|2)/i, tokens: 1_048_576 },
  { re: /qwen/i, tokens: 32_768 },
  { re: /llama-?3/i, tokens: 128_000 },
];

export function knownContextWindow(model: string): number | null {
  const id = model.trim();
  if (!id) return null;
  for (const row of KNOWN_WINDOWS) if (row.re.test(id)) return row.tokens;
  return null;
}

/** Prefer the size reported by the provider. Fall back to a known model window. */
export function resolveContextWindow(model: string, reported: number | null | undefined): number | null {
  if (reported && reported >= 1024) return Math.floor(reported);
  return knownContextWindow(model);
}

export function formatTokenCount(n: number): string {
  if (n < 1000) return String(Math.max(0, Math.round(n)));
  const k = n / 1000;
  const digits = k >= 100 ? 0 : 1;
  return `${k.toFixed(digits).replace(/\.0$/, '')}k`;
}
