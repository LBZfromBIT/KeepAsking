import type { ApiMessage, Settings } from '../shared/types';

/** Merge consecutive same-role messages (Anthropic requires strict alternation) */
function normalize(msgs: ApiMessage[]): ApiMessage[] {
  const out: ApiMessage[] = [];
  for (const m of msgs) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += '\n\n' + m.content;
    else out.push({ ...m });
  }
  return out;
}

export async function* sseLines(res: Response): AsyncGenerator<string> {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line.startsWith('data:')) yield line.slice(5).trimStart();
    }
  }
  if (buf.startsWith('data:')) yield buf.slice(5).trimStart();
}

export async function streamChat(
  settings: Settings,
  apiKey: string,
  messages: ApiMessage[],
  onDelta: (text: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const base = settings.baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) throw new Error('Base URL 必须以 http:// 或 https:// 开头');
  const msgs = normalize(messages);
  let res: Response;

  if (settings.provider === 'anthropic') {
    res = await fetch(`${base}/messages`, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 4096,
        temperature: settings.temperature,
        system: settings.systemPrompt || undefined,
        messages: msgs,
        stream: true,
      }),
    });
  } else {
    const all = settings.systemPrompt ? [{ role: 'system', content: settings.systemPrompt }, ...msgs] : msgs;
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: settings.model,
        messages: all,
        temperature: settings.temperature,
        stream: true,
      }),
    });
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`HTTP ${res.status} ${res.statusText}${detail ? `：${detail.slice(0, 500)}` : ''}`);
  }
  if (!res.body) throw new Error('响应没有可读取的流');

  for await (const data of sseLines(res)) {
    if (!data || data === '[DONE]') continue;
    let json: any;
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
    if (settings.provider === 'anthropic') {
      if (json.type === 'content_block_delta' && json.delta?.text) onDelta(json.delta.text);
    } else {
      const t = json.choices?.[0]?.delta?.content;
      if (t) onDelta(t);
    }
  }
}
