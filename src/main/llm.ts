import type { ApiMessage, ModelInfo, Provider, Settings, ThinkingEffort } from '../shared/types';

function thinkingPayload(settings: Settings): Record<string, unknown> {
  const effort: ThinkingEffort = settings.thinkingEffort;
  if (effort !== 'low' && effort !== 'medium' && effort !== 'high') return {};
  if (settings.provider === 'anthropic') return { output_config: { effort } };
  return { reasoning_effort: effort };
}

function anthropicMaxTokens(effort: ThinkingEffort | undefined): number {
  if (effort === 'high') return 16000;
  if (effort === 'medium') return 8000;
  return 4096;
}

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
        max_tokens: anthropicMaxTokens(settings.thinkingEffort),
        temperature: settings.temperature,
        system: settings.systemPrompt || undefined,
        messages: msgs,
        stream: true,
        ...thinkingPayload(settings),
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
        ...thinkingPayload(settings),
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

function readContextWindow(row: unknown): number | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  for (const key of ['context_window', 'context_length', 'contextWindow', 'max_context_length', 'max_model_len']) {
    const n = Number(record[key]);
    if (Number.isFinite(n) && n >= 1024 && n <= 10_000_000) return Math.floor(n);
  }
  return null;
}

/** Pull models out of OpenAI-style `{ data: [{ id }] }` or `{ models: [{ name }] }`. */
export function parseModelCatalog(json: unknown): ModelInfo[] {
  const record = json && typeof json === 'object' ? (json as { data?: unknown; models?: unknown }) : null;
  const rows = Array.isArray(json) ? json : Array.isArray(record?.data) ? record.data : Array.isArray(record?.models) ? record.models : [];
  const byId = new Map<string, number | null>();
  for (const row of rows) {
    const id =
      typeof row === 'string'
        ? row
        : row && typeof row === 'object'
          ? String((row as { id?: unknown }).id ?? (row as { name?: unknown }).name ?? '')
          : '';
    const trimmed = id.trim();
    if (!trimmed) continue;
    const reported = readContextWindow(row);
    if (!byId.has(trimmed) || (reported && !byId.get(trimmed))) byId.set(trimmed, reported);
  }
  return [...byId.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, contextWindow]) => ({ id, contextWindow }));
}

export function parseModelIds(json: unknown): string[] {
  return parseModelCatalog(json).map((m) => m.id);
}

export async function listModels(provider: Provider, baseUrl: string, apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]> {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) throw new Error('Base URL 必须以 http:// 或 https:// 开头');
  const headers: Record<string, string> = { accept: 'application/json' };
  if (provider === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }
  const res = await fetch(`${base}/models`, { method: 'GET', headers, signal });
  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`HTTP ${res.status} ${res.statusText}${detail ? `：${detail.slice(0, 300)}` : ''}`);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error('模型列表不是 JSON');
  }
  return parseModelCatalog(json);
}
