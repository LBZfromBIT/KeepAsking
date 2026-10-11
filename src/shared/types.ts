export type Provider = 'openai' | 'anthropic';

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

export interface ChatNode {
  id: string;
  sessionId: string;
  parentId: string | null;
  anchor?: Anchor;
  title: string;
  messages: Message[];
  createdAt: number;
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
  };
  settings: {
    get(): Promise<SettingsState>;
    save(update: SettingsUpdate): Promise<SettingsState>;
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
};

export const emptyData = (): AppData => ({
  version: 1,
  sessions: {},
  nodes: {},
  currentSessionId: null,
  currentNodeId: null,
});
