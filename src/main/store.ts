import { safeStorage } from 'electron';
import { promises as fsp, readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { sanitizeFont } from '../shared/appearance';
import { samePath } from '../shared/dataDir';
import {
  DEFAULT_SETTINGS,
  emptyData,
  type AppData,
  type DataDirKind,
  type DataDirState,
  type KeyStorage,
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
  const s = readJson<Partial<Settings>>(settingsFile(), {});
  return sanitizeSettings({ ...DEFAULT_SETTINGS, ...s });
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

let cachedKey: string | null = null;

export function getApiKey(): string {
  if (cachedKey !== null) return cachedKey;
  cachedKey = '';
  try {
    if (existsSync(keyFile()) && ensureEncryption()) {
      cachedKey = safeStorage.decryptString(readFileSync(keyFile()));
    }
  } catch (e) {
    console.error('Failed to decrypt API key', e);
  }
  return cachedKey;
}

function setApiKey(key: string) {
  mkdirSync(dir(), { recursive: true });
  if (!key) {
    if (existsSync(keyFile())) writeFileSync(keyFile(), Buffer.alloc(0));
    cachedKey = '';
    return;
  }
  if (!ensureEncryption()) throw new Error('系统加密不可用，无法安全保存 API Key');
  writeFileSync(keyFile(), safeStorage.encryptString(key), { mode: 0o600 });
  cachedKey = key;
}

export function settingsState(): SettingsState {
  return { ...loadSettings(), hasApiKey: !!getApiKey(), keyStorage: keyStorage() };
}

function sanitizeSettings(s: Settings): Settings {
  const theme = s.theme === 'light' || s.theme === 'dark' || s.theme === 'system' ? s.theme : DEFAULT_SETTINGS.theme;
  return {
    provider: s.provider === 'anthropic' ? 'anthropic' : 'openai',
    baseUrl: String(s.baseUrl ?? DEFAULT_SETTINGS.baseUrl).trim(),
    model: String(s.model ?? '').trim(),
    systemPrompt: String(s.systemPrompt ?? ''),
    temperature: Math.min(2, Math.max(0, Number(s.temperature) || 0)),
    theme,
    fontLatin: sanitizeFont(s.fontLatin, DEFAULT_SETTINGS.fontLatin),
    fontCjk: sanitizeFont(s.fontCjk, DEFAULT_SETTINGS.fontCjk),
    thinkingEffort:
      s.thinkingEffort === 'low' || s.thinkingEffort === 'medium' || s.thinkingEffort === 'high' ? s.thinkingEffort : 'off',
  };
}

export function saveSettings(update: SettingsUpdate): SettingsState {
  const saved = sanitizeSettings(update.settings);
  writeJsonSync(settingsFile(), saved);
  applyNativeTheme(saved.theme);
  if (typeof update.apiKey === 'string') setApiKey(update.apiKey.trim());
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
  cachedKey = null;
  const settings = settingsState();
  applyNativeTheme(settings.theme);
  return { dataDir: dest, data: loadData(), settings };
}
