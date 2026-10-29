export type CliId = 'claude' | 'codex' | 'grok';
export type ChatRoute = 'api' | CliId;

export const CLI_LABEL: Record<CliId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  grok: 'Grok',
};

export function asRoute(value: unknown): ChatRoute {
  return value === 'claude' || value === 'codex' || value === 'grok' ? value : 'api';
}

export function formatCliPrompt(system: string, messages: { role: string; content: string }[]): string {
  const lines = ['你在「追问」里回答用户。只输出给用户看的回答，不要修改文件，不要运行命令。'];
  if (system.trim()) lines.push('', '系统说明：', system.trim());
  lines.push('', '对话：');
  for (const message of messages) {
    lines.push('', message.role === 'assistant' ? '助手：' : '用户：', message.content);
  }
  lines.push('', '请直接回答最后一条用户消息。');
  return lines.join('\n');
}

export interface CliArgs {
  args: string[];
  /** When true, the prompt is written to stdin. Otherwise it is the file in `promptPath`. */
  stdin: boolean;
}

/** Fixed flags only. The prompt itself is never placed on the command line. */
export function cliInvocation(id: CliId, promptPath: string, cwd: string, model = ''): CliArgs {
  const chosen = model.trim();
  if (id === 'claude') {
    return {
      stdin: true,
      args: [
        '-p',
        ...(chosen ? ['--model', chosen] : []),
        '--output-format', 'stream-json', '--include-partial-messages', '--verbose', '--permission-mode', 'dontAsk', '--max-turns', '1',
      ],
    };
  }
  if (id === 'codex') {
    return {
      stdin: true,
      args: [
        'exec',
        ...(chosen ? ['-m', chosen] : []),
        '--json', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral', '--color', 'never', '--cd', cwd, '-',
      ],
    };
  }
  return {
    stdin: false,
    args: [
      ...(chosen ? ['--model', chosen] : []),
      '--prompt-file',
      promptPath,
      '--output-format',
      'streaming-messages-json',
      '--include-partial-messages',
      '--permission-mode',
      'dontAsk',
      '--max-turns',
      '1',
      '--verbatim',
      '--no-alt-screen',
      '--cwd',
      cwd,
    ],
  };
}

export interface CliParseState {
  sawText: boolean;
  items: Record<string, string>;
}

export function emptyCliParse(): CliParseState {
  return { sawText: false, items: {} };
}

export interface CliEvent {
  text: string;
  error: string;
}

function textDelta(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const delta = value as { type?: string; text?: string };
  if (delta.type === 'text_delta' && typeof delta.text === 'string') return delta.text;
  return '';
}

function anthropicEvent(obj: Record<string, unknown>, state: CliParseState): CliEvent {
  const nested = obj.event && typeof obj.event === 'object' ? (obj.event as Record<string, unknown>) : obj;
  const fromDelta = textDelta(nested.delta);
  if (fromDelta) {
    state.sawText = true;
    return { text: fromDelta, error: '' };
  }
  if (obj.type === 'result' && typeof obj.result === 'string' && !state.sawText) {
    state.sawText = true;
    return { text: obj.result, error: '' };
  }
  const err = typeof obj.error === 'string' ? obj.error : '';
  if (obj.type === 'error' && err) return { text: '', error: err };
  return { text: '', error: '' };
}

function codexEvent(obj: Record<string, unknown>, state: CliParseState): CliEvent {
  if (obj.type === 'error') {
    const message = typeof obj.message === 'string' ? obj.message : 'Codex 返回了错误';
    return { text: '', error: message };
  }
  if (obj.type === 'turn.failed') {
    const error = obj.error && typeof obj.error === 'object' ? (obj.error as { message?: string }).message : '';
    return { text: '', error: error || 'Codex 这一轮失败了' };
  }
  const item = obj.item && typeof obj.item === 'object' ? (obj.item as Record<string, unknown>) : null;
  if (!item || (item.type !== 'agent_message' && item.type !== 'message')) return { text: '', error: '' };
  const text = typeof item.text === 'string' ? item.text : '';
  if (!text) return { text: '', error: '' };
  const id = typeof item.id === 'string' ? item.id : 'message';
  const prev = state.items[id] ?? '';
  const next = text.startsWith(prev) ? text.slice(prev.length) : text;
  state.items[id] = text.startsWith(prev) ? text : prev + text;
  if (next) state.sawText = true;
  return { text: next, error: '' };
}

/** One stdout line from a CLI. Non-JSON progress lines are ignored. */
export function readCliEvent(id: CliId, line: string, state: CliParseState): CliEvent {
  const trimmed = line.trim();
  if (!trimmed) return { text: '', error: '' };
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return { text: '', error: '' };
  }
  if (!obj || typeof obj !== 'object') return { text: '', error: '' };
  const record = obj as Record<string, unknown>;
  return id === 'codex' ? codexEvent(record, state) : anthropicEvent(record, state);
}
