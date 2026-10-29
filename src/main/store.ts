import { safeStorage } from 'electron';
import { promises as fsp, readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { sanitizeFont } from '../shared/appearance';
import { samePath } from '../shared/dataDir';
import type { CliId } from '../shared/cli';
import {
  DEFAULT_SETTINGS,
  emptyData,
  type AppData,
  type CloudAccount,
  type DataDirKind,
  type DataDirState,
  type KeyStorage,
  type Provider,
  type Settings,
  type SettingsState,
  type SettingsUpdate,
} from '../shared/types';
import { applyNativeTheme } from './appearance';
import { currentDataDir, setActiveDataDir, writeDataPointer } from './dataDir';
import { removeDataFiles, transferDataFiles } from './transfer';

const dir = () => currentDataDir();
const dataFile = () => join(dir(), 'data.json');
const settingsFile = () => join(dir(), 'settings.json');
const keyFile = () => join(dir(), 'apikey.bin');
const keysFile = () => join(dir(), 'provider-keys.bin');
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,40}$/;

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Atomic write: write to a temp file, then rename over the target */
function writeJsonSync(file: string, value: unknown) {
  mkdirSync(dir(), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, file);
}

let writeChain: Promise<void> = Promise.resolve();
async function writeJson(file: string, value: unknown) {
  const run = async () => {
    await fsp.mkdir(dir(), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(value));
    await fsp.rename(tmp, file);
  };
  writeChain = writeChain.then(run, run);
  return writeChain;
}

// ---------- conversation data ----------
export function loadData(): AppData {
  const d = readJson<AppData>(dataFile(), emptyData());
  for (const n of Object.values(d.nodes ?? {})) {
    for (const m of n.messages) if (m.status === 'streaming') m.status = m.content ? 'done' : 'error';
  }
  return { ...emptyData(), ...d };
}

export const saveData = (d: AppData) => writeJson(dataFile(), d);
export const saveDataSync = (d: AppData) => writeJsonSync(dataFile(), d);

// ---------- settings ----------
export function loadSettings(): Settings {
  const raw = readJson<Partial<Settings>>(settingsFile(), {});
  return sanitizeSettings({ ...DEFAULT_SETTINGS, ...raw }, Array.isArray(raw.accounts));
}

// ---------- API key (encrypted with safeStorage) ----------
let plainTextFallback = false;

/**
 * Linux without a keyring (headless, minimal WMs): Chromium can't reach libsecret/kwallet.
 * Fall back to Chromium's built-in obfuscation key so the app still works, and tell the user.
 */
function ensureEncryption(): boolean {
  if (safeStorage.isEncryptionAvailable()) return true;
  if (process.platform === 'linux' && !plainTextFallback) {
    safeStorage.setUsePlainTextEncryption(true);
    plainTextFallback = true;
  }
  return safeStorage.isEncryptionAvailable();
}

export function keyStorage(): KeyStorage {
  if (!ensureEncryption()) return 'unavailable';
  if (plainTextFallback) return 'basic_text';
  if (process.platform === 'linux') {
    // 'basic_text' means no OS keyring was found: Chromium uses a hard-coded password
    const backend = safeStorage.getSelectedStorageBackend?.();
    if (backend === 'basic_text' || backend === 'unknown') return 'basic_text';
  }
  return 'os';
}

let cachedMap: Record<string, string> | null = null;

function readLegacyKey(): string {
  try {
    if (existsSync(keyFile()) && ensureEncryption()) return safeStorage.decryptString(readFileSync(keyFile()));
  } catch (e) {
    console.error('Failed to decrypt API key', e);
  }
  return '';
}

function readKeyMap(): Record<string, string> {
  if (cachedMap) return cachedMap;
  const map: Record<string, string> = {};
  try {
    if (existsSync(keysFile()) && ensureEncryption()) {
      const parsed = JSON.parse(safeStorage.decryptString(readFileSync(keysFile()))) as unknown;
      if (parsed && typeof parsed === 'object') {
        for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (ACCOUNT_ID.test(id) && typeof value === 'string' && value.trim()) map[id] = value;
        }
      }
    }
  } catch (e) {
    console.error('Failed to decrypt provider keys', e);
  }
  const legacy = readLegacyKey();
  if (legacy && !map.default) map.default = legacy;
  cachedMap = map;
  return map;
}

function writeLegacyKey(key: string) {
  mkdirSync(dir(), { recursive: true });
  if (!key) {
    if (existsSync(keyFile())) writeFileSync(keyFile(), Buffer.alloc(0));
    return;
  }
  writeFileSync(keyFile(), safeStorage.encryptString(key), { mode: 0o600 });
}

function writeKeyMap(map: Record<string, string>, activeId: string) {
  if (!ensureEncryption()) throw new Error('系统加密不可用，无法安全保存 API Key');
  const clean: Record<string, string> = {};
  for (const [id, value] of Object.entries(map)) {
    if (ACCOUNT_ID.test(id) && value.trim()) clean[id] = value.trim();
  }
  mkdirSync(dir(), { recursive: true });
  writeFileSync(keysFile(), safeStorage.encryptString(JSON.stringify(clean)), { mode: 0o600 });
  cachedMap = clean;
  writeLegacyKey(clean[activeId] ?? '');
}

export function getApiKeyFor(accountId?: string): string {
  const settings = loadSettings();
  const id = accountId && settings.accounts.some((account) => account.id === accountId) ? accountId : settings.activeProviderId;
  return readKeyMap()[id] ?? '';
}

export function getApiKey(): string {
  return getApiKeyFor();
}

export function settingsState(): SettingsState {
  const settings = loadSettings();
  const map = readKeyMap();
  const accountKeys: Record<string, boolean> = {};
  for (const account of settings.accounts) accountKeys[account.id] = !!map[account.id];
  return { ...settings, hasApiKey: !!accountKeys[settings.activeProviderId], keyStorage: keyStorage(), accountKeys };
}

function accountLabel(baseUrl: string): string {
  try {
    const host = new URL(baseUrl).hostname.replace(/^api\./, '');
    if (host.includes('deepseek')) return 'DeepSeek';
    if (host.includes('openai')) return 'OpenAI';
    if (host.includes('openrouter')) return 'OpenRouter';
    if (host.includes('x.ai')) return 'xAI';
    if (host.includes('anthropic')) return 'Anthropic';
    if (host === 'localhost' || host.startsWith('127.')) return '本地';
    return host || '云端';
  } catch {
    return '云端';
  }
}

function cleanModels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || id.length > 160 || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= 200) break;
  }
  return ids;
}

function sanitizeAccounts(raw: unknown, fallback: { provider: Provider; baseUrl: string; model: string }, keepEmpty = false): CloudAccount[] {
  const list = Array.isArray(raw) ? raw : [];
  const accounts: CloudAccount[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Partial<CloudAccount>;
    const id = typeof row.id === 'string' && ACCOUNT_ID.test(row.id) ? row.id : '';
    if (!id || accounts.some((account) => account.id === id)) continue;
    const model = String(row.model ?? '').trim();
    const models = cleanModels(row.models);
    if (model && !models.includes(model)) models.unshift(model);
    const baseUrl = String(row.baseUrl ?? '').trim();
    accounts.push({
      id,
      label: String(row.label ?? '').trim().slice(0, 40) || accountLabel(baseUrl),
      provider: row.provider === 'anthropic' ? 'anthropic' : 'openai',
      baseUrl,
      model,
      models,
    });
    if (accounts.length >= 12) break;
  }
  if (accounts.length || keepEmpty) return accounts;
  const model = fallback.model.trim();
  return [{
    id: 'default',
    label: accountLabel(fallback.baseUrl),
    provider: fallback.provider,
    baseUrl: fallback.baseUrl,
    model,
    models: model ? [model] : [],
  }];
}

function sanitizeCliModels(raw: unknown): Partial<Record<CliId, string[]>> {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: Partial<Record<CliId, string[]>> = {};
  for (const id of ['claude', 'codex', 'grok'] as const) {
    const models = cleanModels(src[id]);
    if (models.length) out[id] = models;
  }
  return out;
}

function sanitizeSettings(s: Settings, keepEmpty = false): Settings {
  const theme = s.theme === 'light' || s.theme === 'dark' || s.theme === 'system' ? s.theme : DEFAULT_SETTINGS.theme;
  const route = s.route === 'claude' || s.route === 'codex' || s.route === 'grok' ? s.route : 'api';
  const provider = s.provider === 'anthropic' ? 'anthropic' : 'openai';
  const baseUrl = String(s.baseUrl ?? DEFAULT_SETTINGS.baseUrl).trim();
  const model = String(s.model ?? '').trim();
  const accounts = sanitizeAccounts(s.accounts, { provider, baseUrl, model }, keepEmpty);
  const active = accounts.some((account) => account.id === s.activeProviderId) ? s.activeProviderId : accounts[0]?.id ?? '';
  const current = accounts.find((account) => account.id === active);
  if (!current) {
    return {
      provider,
      baseUrl,
      model: route === 'api' ? '' : model,
      systemPrompt: String(s.systemPrompt ?? ''),
      temperature: Math.min(2, Math.max(0, Number(s.temperature) || 0)),
      theme,
      fontLatin: sanitizeFont(s.fontLatin, DEFAULT_SETTINGS.fontLatin),
      fontCjk: sanitizeFont(s.fontCjk, DEFAULT_SETTINGS.fontCjk),
      thinkingEffort:
        s.thinkingEffort === 'low' || s.thinkingEffort === 'medium' || s.thinkingEffort === 'high' ? s.thinkingEffort : 'off',
      route,
      accounts,
      activeProviderId: '',
      cliModels: sanitizeCliModels(s.cliModels),
    };
  }
  return {
    provider: current.provider,
    baseUrl: current.baseUrl,
    model: route === 'api' ? current.model || model : model,
    systemPrompt: String(s.systemPrompt ?? ''),
    temperature: Math.min(2, Math.max(0, Number(s.temperature) || 0)),
    theme,
    fontLatin: sanitizeFont(s.fontLatin, DEFAULT_SETTINGS.fontLatin),
    fontCjk: sanitizeFont(s.fontCjk, DEFAULT_SETTINGS.fontCjk),
    thinkingEffort:
      s.thinkingEffort === 'low' || s.thinkingEffort === 'medium' || s.thinkingEffort === 'high' ? s.thinkingEffort : 'off',
    route,
    accounts,
    activeProviderId: current.id,
    cliModels: sanitizeCliModels(s.cliModels),
  };
}

export function saveSettings(update: SettingsUpdate): SettingsState {
  const saved = sanitizeSettings(update.settings, true);
  writeJsonSync(settingsFile(), saved);
  applyNativeTheme(saved.theme);
  const map = { ...readKeyMap() };
  let keysTouched = false;
  const assign = (id: string, value: string) => {
    if (!saved.accounts.some((account) => account.id === id)) return;
    keysTouched = true;
    if (value.trim()) map[id] = value.trim();
    else delete map[id];
  };
  if (typeof update.apiKey === 'string') assign(saved.activeProviderId, update.apiKey);
  if (update.apiKeys && typeof update.apiKeys === 'object') {
    for (const [id, value] of Object.entries(update.apiKeys)) {
      if (typeof value === 'string') assign(id, value);
    }
  }
  for (const id of Object.keys(map)) {
    if (!saved.accounts.some((account) => account.id === id)) {
      delete map[id];
      keysTouched = true;
    }
  }
  if (keysTouched) writeKeyMap(map, saved.activeProviderId);
  return settingsState();
}

function asDirectory(input: string): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error('请选择文件夹');
  const dest = resolve(input);
  if (!isAbsolute(dest)) throw new Error('请选择一个绝对路径');
  return dest;
}

export function inspectDataDir(input: string): DataDirKind {
  const dest = asDirectory(input);
  if (samePath(dest, currentDataDir())) return 'same';
  if (!existsSync(dest)) return 'empty';
  if (!statSync(dest).isDirectory()) throw new Error('请选择文件夹');
  return existsSync(join(dest, 'data.json')) ? 'existing' : 'empty';
}

export function setDataDirectory(input: string, mode: 'move' | 'switch'): DataDirState {
  const dest = asDirectory(input);
  const from = currentDataDir();
  const kind = inspectDataDir(dest);
  if (kind === 'same') return { dataDir: from, data: loadData(), settings: settingsState() };
  if (mode === 'move' && kind === 'existing') throw new Error('目标文件夹已有数据');
  if (mode === 'switch' && kind !== 'existing') throw new Error('目标文件夹没有可切换的数据');
  mkdirSync(dest, { recursive: true });
  const probe = join(dest, `.write-probe-${process.pid}`);
  writeFileSync(probe, '');
  unlinkSync(probe);
  let copied: string[] = [];
  try {
    if (mode === 'move') copied = transferDataFiles(from, dest);
    writeDataPointer(dest);
    setActiveDataDir(dest);
  } catch (err) {
    if (copied.length) removeDataFiles(dest, copied);
    throw err;
  }
  if (copied.length) removeDataFiles(from, copied);
  cachedMap = null;
  const settings = settingsState();
  applyNativeTheme(settings.theme);
  return { dataDir: dest, data: loadData(), settings };
}
