import { DEFAULT_FONT_CJK, DEFAULT_FONT_LATIN, type ThemeMode } from './appearance';
import type { ChatRoute, CliId } from './cli';
import type { FileAttachment } from './files';

export type { ChatRoute, CliId } from './cli';
export type { FileAttachment } from './files';

export type { ThemeMode };
export type Provider = 'openai' | 'anthropic';
export type ThinkingEffort = 'off' | 'low' | 'medium' | 'high';

/** One saved cloud endpoint. The API key lives outside this object. */
export interface CloudAccount {
  id: string;
  label: string;
  provider: Provider;
  baseUrl: string;
  model: string;
  /** Models last returned by「拉取模型」. */
  models: string[];
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** For the first user message of a branch: the selected text the branch focuses on */
  quote?: string;
  /** Text files the user attached to this message. */
  files?: FileAttachment[];
  status?: 'streaming' | 'done' | 'error';
  error?: string;
  createdAt: number;
}

/** Where a branch was spawned from: a character range inside a parent message's rendered text */
export interface Anchor {
  messageId: string;
  start: number;
  end: number;
  text: string;
}

/** A summary that replaces this node's sent context. The transcript itself stays. */
export interface ContextCompact {
  summary: string;
  /** Last message id included in the summary. Later messages stay verbatim. */
  uptoMessageId: string;
  createdAt: number;
}

export interface ChatNode {
  id: string;
  sessionId: string;
  parentId: string | null;
  anchor?: Anchor;
  /** Inline follow-up. Missing means a normal branch that replaces the main transcript. */
  kind?: 'branch' | 'probe';
  title: string;
  messages: Message[];
  createdAt: number;
  compact?: ContextCompact;
}

export interface Session {
  id: string;
  title: string;
  rootId: string;
  createdAt: number;
  updatedAt: number;
}

/** Non-secret settings (persisted to settings.json). The API key is stored separately, encrypted. */
export interface Settings {
  provider: Provider;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  theme: ThemeMode;
  /** Latin / English UI font family */
  fontLatin: string;
  /** CJK UI font family */
  fontCjk: string;
  /** How much reasoning to request. `off` sends no extra parameter. */
  thinkingEffort: ThinkingEffort;
  /** `api` uses `activeProviderId`. A CLI id sends the turn through that local command. */
  route: ChatRoute;
  /** Saved cloud endpoints. The top-level provider fields mirror the active one. */
  accounts: CloudAccount[];
  activeProviderId: string;
  /** Models last pulled from each local CLI. */
  cliModels: Partial<Record<CliId, string[]>>;
}

export interface ModelInfo {
  id: string;
  /** null when the provider did not report a context window */
  contextWindow: number | null;
}

export interface ModelListRequest {
  provider: Provider;
  baseUrl: string;
  /** undefined = use the saved key for `accountId`, '' = no key */
  apiKey?: string;
  /** Which saved cloud account's key to use when `apiKey` is omitted. */
  accountId?: string;
}

/** How the API key is protected on disk */
export type KeyStorage = 'os' | 'basic_text' | 'unavailable';

/** What the renderer sees: never the key itself */
export interface SettingsState extends Settings {
  /** Whether the active cloud account has a saved key. */
  hasApiKey: boolean;
  keyStorage: KeyStorage;
  /** Account id → whether a key is saved. Values are booleans, never the key. */
  accountKeys: Record<string, boolean>;
}

export interface SettingsUpdate {
  settings: Settings;
  /** undefined = keep the active account's key, '' = clear it, otherwise replace it. */
  apiKey?: string;
  /** Keys for accounts other than the one covered by `apiKey`. '' clears. */
  apiKeys?: Record<string, string>;
}

export interface AppData {
  version: 1;
  sessions: Record<string, Session>;
  nodes: Record<string, ChatNode>;
  currentSessionId: string | null;
  currentNodeId: string | null;
}

export interface ApiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  requestId: string;
  messages: ApiMessage[];
  /** `compact` summarizes the messages. It does not use the saved system prompt or reasoning effort. */
  purpose?: 'chat' | 'compact';
  /** Ignored for `compact`, which always uses the API provider. */
  route?: ChatRoute;
}

export interface CliInfo {
  id: 'claude' | 'codex' | 'grok';
  label: string;
  installed: boolean;
  version: string;
  command: string;
  model: string;
  signedIn: boolean;
  detail: string;
}

export type DataDirKind = 'same' | 'empty' | 'existing';

export interface DataDirState {
  dataDir: string;
  data: AppData;
  settings: SettingsState;
}

export type ChatEvent =
  | { requestId: string; type: 'delta'; text: string }
  | { requestId: string; type: 'done' }
  | { requestId: string; type: 'error'; error: string; aborted?: boolean };

/** API exposed by the preload script on window.api */
export interface BranchChatApi {
  platform: string;
  data: {
    load(): Promise<AppData>;
    save(data: AppData): Promise<void>;
    saveSync(data: AppData): void;
    exportToFile(json: string, defaultName: string): Promise<string | null>;
    importFromFile(): Promise<string | null>;
    openDataFolder(): Promise<void>;
    getDir(): Promise<string>;
    chooseDir(): Promise<string | null>;
    inspectDir(dir: string): Promise<DataDirKind>;
    /** `move` relocates the current files. `switch` opens a folder that already has data. */
    setDir(dir: string, mode: 'move' | 'switch'): Promise<DataDirState>;
  };
  settings: {
    get(): Promise<SettingsState>;
    /** Synchronous read so the first paint can match the saved theme. */
    peek(): SettingsState;
    save(update: SettingsUpdate): Promise<SettingsState>;
    applyAppearance(theme: ThemeMode): Promise<void>;
  };
  models: {
    list(req: ModelListRequest): Promise<ModelInfo[]>;
  };
  cli: {
    list(): Promise<CliInfo[]>;
    /** Ask the local command for its model ids. The key never leaves the main process. */
    models(id: CliId): Promise<string[]>;
    /** Model id → context window, from the local CLI catalog. */
    windows(): Promise<Record<string, number>>;
  };
  files: {
    /** Opens a file dialog and returns the text of the chosen files. `null` if cancelled. */
    pick(): Promise<FileAttachment[] | null>;
  };
  chat: {
    start(req: ChatRequest): Promise<void>;
    abort(requestId: string): void;
    onEvent(cb: (ev: ChatEvent) => void): () => void;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  systemPrompt: '你是一个知识渊博、表达清晰的助手。请使用 Markdown 组织回答，默认使用用户的语言回复。',
  temperature: 0.7,
  theme: 'dark',
  fontLatin: DEFAULT_FONT_LATIN,
  fontCjk: DEFAULT_FONT_CJK,
  thinkingEffort: 'off',
  route: 'api',
  accounts: [],
  activeProviderId: '',
  cliModels: {},
};

export function toSettings(s: Settings): Settings {
  return {
    provider: s.provider,
    baseUrl: s.baseUrl,
    model: s.model,
    systemPrompt: s.systemPrompt,
    temperature: s.temperature,
    theme: s.theme,
    fontLatin: s.fontLatin,
    fontCjk: s.fontCjk,
    thinkingEffort: s.thinkingEffort,
    route: s.route === 'claude' || s.route === 'codex' || s.route === 'grok' ? s.route : 'api',
    accounts: s.accounts,
    activeProviderId: s.activeProviderId,
    cliModels: s.cliModels,
  };
}

export const emptyData = (): AppData => ({
  version: 1,
  sessions: {},
  nodes: {},
  currentSessionId: null,
  currentNodeId: null,
});
