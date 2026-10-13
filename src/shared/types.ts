import { DEFAULT_FONT_CJK, DEFAULT_FONT_LATIN, type ThemeMode } from './appearance';

export type { ThemeMode };
export type Provider = 'openai' | 'anthropic';
export type ThinkingEffort = 'off' | 'low' | 'medium' | 'high';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** For the first user message of a branch: the selected text the branch focuses on */
  quote?: string;
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
}

export interface ModelInfo {
  id: string;
  /** null when the provider did not report a context window */
  contextWindow: number | null;
}

export interface ModelListRequest {
  provider: Provider;
  baseUrl: string;
  /** undefined = use the saved key, '' = no key */
  apiKey?: string;
}

/** How the API key is protected on disk */
export type KeyStorage = 'os' | 'basic_text' | 'unavailable';

/** What the renderer sees: never the key itself */
export interface SettingsState extends Settings {
  hasApiKey: boolean;
  keyStorage: KeyStorage;
}

export interface SettingsUpdate {
  settings: Settings;
  /** undefined = keep current key, '' = clear, otherwise replace */
  apiKey?: string;
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
  };
}

export const emptyData = (): AppData => ({
  version: 1,
  sessions: {},
  nodes: {},
  currentSessionId: null,
  currentNodeId: null,
});
