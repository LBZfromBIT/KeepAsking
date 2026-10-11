import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamChat } from '../src/main/llm';
import { DEFAULT_SETTINGS } from '../src/shared/types';

function sseResponse(lines: string[], split = 7): Response {
  const text = lines.join('\n');
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      // Deliberately split across chunk boundaries
      for (let i = 0; i < text.length; i += split) c.enqueue(enc.encode(text.slice(i, i + split)));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('streamChat', () => {
  it('parses OpenAI-compatible SSE and sends bearer auth + system prompt', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"你好"}}]}',
        '',
        'data: {"choices":[{"delta":{"content":"，世界"}}]}',
        '',
        'data: [DONE]',
        '',
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    let out = '';
    await streamChat({ ...DEFAULT_SETTINGS, baseUrl: 'https://x.test/v1/' }, 'sk-1', [{ role: 'user', content: 'hi' }], (t) => (out += t), new AbortController().signal);
    expect(out).toBe('你好，世界');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://x.test/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-1');
    const body = JSON.parse(init.body as string);
    expect(body.stream).toBe(true);
    expect(body.messages[0].role).toBe('system');
  });

  it('parses Anthropic SSE and merges consecutive same-role messages', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      sseResponse([
        'event: message_start',
        'data: {"type":"message_start"}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"AB"}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"C"}}',
        '',
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    let out = '';
    await streamChat(
      { ...DEFAULT_SETTINGS, provider: 'anthropic', baseUrl: 'https://a.test/v1' },
      'k',
      [
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
      ],
      (t) => (out += t),
      new AbortController().signal,
    );
    expect(out).toBe('ABC');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://a.test/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('k');
    expect(JSON.parse(init.body as string).messages).toEqual([{ role: 'user', content: 'a\n\nb' }]);
  });

  it('throws with status and body on HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"bad key"}', { status: 401, statusText: 'Unauthorized' })));
    await expect(
      streamChat(DEFAULT_SETTINGS, 'k', [{ role: 'user', content: 'x' }], () => {}, new AbortController().signal),
    ).rejects.toThrow(/HTTP 401.*bad key/);
  });

  it('rejects non-http base URLs', async () => {
    await expect(
      streamChat({ ...DEFAULT_SETTINGS, baseUrl: 'file:///etc' }, 'k', [], () => {}, new AbortController().signal),
    ).rejects.toThrow(/Base URL/);
  });
});
