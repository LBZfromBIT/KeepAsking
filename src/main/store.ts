import { app, safeStorage } from 'electron';
import { promises as fsp, readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_SETTINGS,
  emptyData,
  type AppData,
  type KeyStorage,
  type Settings,
  type SettingsState,
  type SettingsUpdate,
} from '../shared/types';

const dir = () => app.getPath('userData');
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
  return { ...DEFAULT_SETTINGS, ...s };
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
  return {
    provider: s.provider === 'anthropic' ? 'anthropic' : 'openai',
    baseUrl: String(s.baseUrl ?? DEFAULT_SETTINGS.baseUrl).trim(),
    model: String(s.model ?? '').trim(),
    systemPrompt: String(s.systemPrompt ?? ''),
    temperature: Math.min(2, Math.max(0, Number(s.temperature) || 0)),
  };
}

export function saveSettings(update: SettingsUpdate): SettingsState {
  writeJsonSync(settingsFile(), sanitizeSettings(update.settings));
  if (typeof update.apiKey === 'string') setApiKey(update.apiKey.trim());
  return settingsState();
}
