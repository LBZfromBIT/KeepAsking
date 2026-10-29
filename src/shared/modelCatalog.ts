import { CLI_LABEL, type CliId, type ChatRoute } from './cli';
import type { CloudAccount } from './types';

const CLI_ORDER: CliId[] = ['claude', 'codex', 'grok'];

/** Model names from Claude Code settings. Auth tokens are ignored. */
export function claudeModelIds(settings: unknown): string[] {
  if (!settings || typeof settings !== 'object') return [];
  const root = settings as Record<string, unknown>;
  const ids: string[] = [];
  const push = (value: unknown) => {
    if (typeof value !== 'string') return;
    const id = value.trim();
    if (!id || id.length > 160 || /\s/.test(id) || /sk-|token|secret|bearer/i.test(id)) return;
    if (!ids.includes(id)) ids.push(id);
  };
  push(root.model);
  if (root.modelSettings && typeof root.modelSettings === 'object') {
    for (const key of Object.keys(root.modelSettings as object)) push(key);
  }
  if (root.env && typeof root.env === 'object') {
    for (const [key, value] of Object.entries(root.env as Record<string, unknown>)) {
      if (!/MODEL/i.test(key) || /TOKEN|KEY|SECRET|AUTH|NAME/i.test(key)) continue;
      push(value);
    }
  }
  return ids;
}

function codexRows(value: unknown): { slug?: unknown; context_window?: unknown }[] {
  const record = value && typeof value === 'object' ? (value as { models?: unknown }) : null;
  return Array.isArray(record?.models) ? record.models : [];
}

/** `codex debug models` returns `{ models: [{ slug }] }`. */
export function codexModelIds(value: unknown): string[] {
  const ids: string[] = [];
  for (const row of codexRows(value)) {
    if (!row || typeof row !== 'object') continue;
    if (typeof row.slug !== 'string') continue;
    const id = row.slug.trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Context windows published beside each Codex model slug. */
export function codexModelWindows(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of codexRows(value)) {
    if (!row || typeof row !== 'object' || typeof row.slug !== 'string') continue;
    const id = row.slug.trim();
    const tokens = typeof row.context_window === 'number' ? Math.floor(row.context_window) : 0;
    if (id && tokens >= 1024) out[id] = tokens;
  }
  return out;
}

function windowForModelId(id: string): number | null {
  if (/\[1m\]/i.test(id)) return 1_000_000;
  if (/claude/i.test(id)) return 200_000;
  return null;
}

/** Claude Code model ids, plus aliases such as `fable` when the config names their target. */
export function claudeContextWindows(settings: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const root = settings && typeof settings === 'object' ? (settings as { env?: unknown }) : null;
  const env = root?.env && typeof root.env === 'object' ? (root.env as Record<string, unknown>) : {};
  const aliasWindow = new Map<string, number>();
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string' || !/MODEL/i.test(key) || /TOKEN|KEY|SECRET|AUTH|NAME/i.test(key)) continue;
    const tokens = windowForModelId(value.trim());
    const alias = /^ANTHROPIC_DEFAULT_([A-Z0-9]+)_MODEL$/i.exec(key)?.[1]?.toLowerCase();
    if (alias && tokens) aliasWindow.set(alias, tokens);
  }
  for (const id of claudeModelIds(settings)) {
    const tokens = aliasWindow.get(id.toLowerCase()) ?? windowForModelId(id);
    if (tokens) out[id] = tokens;
  }
  return out;
}

/** `grok models` prints one model id per bullet. */
export function grokModelIds(text: string): string[] {
  const ids: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*[*•-]\s+(\S+)/.exec(line);
    if (!match) continue;
    const id = match[1].replace(/[，,。]+$/g, '');
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export interface ModelGroup {
  id: string;
  label: string;
  route: ChatRoute;
  providerId?: string;
  models: string[];
}

function unique(ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const trimmed = id.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

/** One picker list: each cloud account, then each local CLI. */
export function modelGroups(input: {
  accounts: CloudAccount[];
  extraByAccount?: Record<string, string[]>;
  cliModels?: Partial<Record<CliId, string[]>>;
  cliConfigured?: Partial<Record<CliId, string>>;
  cliInstalled?: Partial<Record<CliId, boolean>>;
}): ModelGroup[] {
  const groups: ModelGroup[] = [];
  for (const account of input.accounts) {
    const models = unique([account.model, ...account.models, ...(input.extraByAccount?.[account.id] ?? [])]);
    groups.push({
      id: `cloud:${account.id}`,
      label: account.label || '云端',
      route: 'api',
      providerId: account.id,
      models,
    });
  }
  for (const id of CLI_ORDER) {
    const installed = input.cliInstalled?.[id];
    const models = unique([...(input.cliModels?.[id] ?? []), input.cliConfigured?.[id] ?? '']);
    if (installed === false && models.length === 0) continue;
    if (installed === undefined && models.length === 0) continue;
    groups.push({ id: `cli:${id}`, label: CLI_LABEL[id], route: id, models });
  }
  return groups;
}
