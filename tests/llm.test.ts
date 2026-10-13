import { afterEach, describe, expect, it, vi } from 'vitest';
import { listModels, parseModelCatalog, parseModelIds, streamChat } from '../src/main/llm';
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
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('sends reasoning effort only when it is turned on', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => sseResponse(['data: [DONE]', '']));
    vi.stubGlobal('fetch', fetchMock);
    await streamChat(
      { ...DEFAULT_SETTINGS, thinkingEffort: 'high', baseUrl: 'https://x.test/v1' },
      'sk-1',
      [{ role: 'user', content: 'hi' }],
      () => {},
      new AbortController().signal,
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).reasoning_effort).toBe('high');

    const anthropic = vi.fn(async (_url: string, _init: RequestInit) => sseResponse(['data: {"type":"message_stop"}', '']));
    vi.stubGlobal('fetch', anthropic);
    await streamChat(
      { ...DEFAULT_SETTINGS, provider: 'anthropic', thinkingEffort: 'medium', baseUrl: 'https://a.test/v1' },
      'k',
      [{ role: 'user', content: 'hi' }],
      () => {},
      new AbortController().signal,
    );
    const body = JSON.parse(anthropic.mock.calls[0][1].body as string);
    expect(body.output_config).toEqual({ effort: 'medium' });
    expect(body.max_tokens).toBe(8000);
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

describe('listModels', () => {
  it('reads ids from OpenAI and Anthropic payloads', () => {
    expect(parseModelIds({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }] })).toEqual(['a', 'b']);
    expect(parseModelIds({ models: [{ name: 'qwen2.5' }] })).toEqual(['qwen2.5']);
    expect(parseModelCatalog({ data: [{ id: 'm', context_length: 128000 }, { id: 'n' }] })).toEqual([
      { id: 'm', contextWindow: 128000 },
      { id: 'n', contextWindow: null },
    ]);
  });

  it('calls GET /models with bearer auth for OpenAI-compatible providers', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ data: [{ id: 'mock-model' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(listModels('openai', 'http://127.0.0.1:8787/v1/', 'sk-1')).resolves.toEqual([{ id: 'mock-model', contextWindow: null }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8787/v1/models');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-1');
  });

  it('calls GET /models with the Anthropic key header', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ data: [{ id: 'claude-sonnet' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await listModels('anthropic', 'https://api.anthropic.com/v1', 'sk-ant');
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant');
    expect((init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
  });
});
