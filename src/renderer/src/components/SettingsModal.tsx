import { useEffect, useRef, useState } from 'react';
import { sanitizeFont } from '../../../shared/appearance';
import { fontChoices } from '../../../shared/fonts';
import type { CloudAccount, Provider, Settings, SettingsState, SettingsUpdate, ThemeMode } from '../../../shared/types';
import type { CliId } from '../../../shared/cli';
import { CliSettings } from './CliSettings';

interface Props {
  settings: SettingsState;
  onSave: (u: SettingsUpdate) => void;
  onClose: () => void;
  onPreview: (patch: Pick<Settings, 'theme' | 'fontLatin' | 'fontCjk'>) => void;
  onRelocate: (dir: string, mode: 'move' | 'switch') => Promise<void>;
}

const PRESETS: { label: string; provider: Provider; baseUrl: string; model: string }[] = [
  { label: 'OpenAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: 'DeepSeek', provider: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: 'OpenRouter', provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  { label: 'xAI', provider: 'openai', baseUrl: 'https://api.x.ai/v1', model: 'grok-3-mini' },
  { label: 'Ollama 本地', provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5' },
  { label: 'Anthropic', provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5' },
];

const THEMES: { id: ThemeMode; label: string }[] = [
  { id: 'light', label: '白天' },
  { id: 'dark', label: '黑暗' },
  { id: 'system', label: '跟随系统' },
];

const STORAGE_NOTE: Record<SettingsState['keyStorage'], string> = {
  os: 'API Key 已通过系统钥匙串（Keychain / DPAPI / libsecret）加密保存在本机。',
  basic_text: '未检测到系统密钥环（如 gnome-keyring / KWallet），Key 仅做了弱加密。建议安装密钥环服务。',
  unavailable: '系统加密不可用，无法保存 API Key。',
};

type Page = 'general' | 'personal' | 'provider';
type ProviderView = 'network' | 'cli';

export function SettingsModal({ settings, onSave, onClose, onPreview, onRelocate }: Props) {
  const [page, setPage] = useState<Page>('general');
  const [providerView, setProviderView] = useState<ProviderView>(settings.route === 'api' ? 'network' : 'cli');
  const [s, setS] = useState<Settings>({
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    systemPrompt: settings.systemPrompt,
    temperature: settings.temperature,
    theme: settings.theme,
    fontLatin: settings.fontLatin,
    fontCjk: settings.fontCjk,
    thinkingEffort: settings.thinkingEffort,
    route: settings.route,
    accounts: settings.accounts,
    activeProviderId: settings.activeProviderId,
    cliModels: settings.cliModels,
  });
  const [accountId, setAccountId] = useState(settings.activeProviderId || settings.accounts[0]?.id || 'default');
  const [installedFonts, setInstalledFonts] = useState<string[]>([]);
  const [key, setKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [show, setShow] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [listing, setListing] = useState(false);
  const [dataDir, setDataDir] = useState('');
  const [dirError, setDirError] = useState('');
  const [dirBusy, setDirBusy] = useState(false);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    onPreview({ theme: s.theme, fontLatin: s.fontLatin, fontCjk: s.fontCjk });
  }, [s.theme, s.fontLatin, s.fontCjk, onPreview]);

  useEffect(() => {
    let cancel = false;
    void window.api.data.getDir().then((dir) => {
      if (!cancel) setDataDir(dir);
    });
    return () => {
      cancel = true;
    };
  }, []);

  const changeDataDir = async () => {
    setDirError('');
    const picked = await window.api.data.chooseDir();
    if (!picked) return;
    let kind: 'same' | 'empty' | 'existing';
    try {
      kind = await window.api.data.inspectDir(picked);
    } catch (e: unknown) {
      setDirError(ipcMessage(e));
      return;
    }
    if (kind === 'same') return;
    const ok = kind === 'existing'
      ? window.confirm('这个文件夹里已经有追问的数据。切换后将打开那里的会话，当前文件夹里的文件会保留。未保存的设置更改会丢弃。')
      : window.confirm('将把当前的会话、设置和 API Key 移到这个文件夹，并立即改用它。未保存的设置更改会丢弃。');
    if (!ok) return;
    setDirBusy(true);
    try {
      await onRelocate(picked, kind === 'existing' ? 'switch' : 'move');
      setDataDir(picked);
    } catch (e: unknown) {
      setDirError(ipcMessage(e));
    } finally {
      setDirBusy(false);
    }
  };

  useEffect(() => {
    const query = (window as Window & { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
    if (typeof query !== 'function') return;
    let cancel = false;
    query()
      .then((fonts) => {
        if (cancel) return;
        const families = [...new Set(fonts.map((f) => f.family.trim()).filter(Boolean))];
        families.sort((a, b) => a.localeCompare(b, 'zh'));
        setInstalledFonts(families);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  const account = s.accounts.find((item) => item.id === accountId) ?? s.accounts[0];

  const patchAccount = (id: string, patch: Partial<CloudAccount>) => {
    setS((prev) => {
      const accounts = prev.accounts.map((item) => (item.id === id ? { ...item, ...patch } : item));
      const active = accounts.find((item) => item.id === prev.activeProviderId) ?? accounts[0];
      if (!active) return { ...prev, accounts };
      return {
        ...prev,
        accounts,
        provider: active.provider,
        baseUrl: active.baseUrl,
        model: prev.route === 'api' ? active.model : prev.model,
        activeProviderId: active.id,
      };
    });
  };

  const selectAccount = (id: string) => {
    setAccountId(id);
    setKey('');
    setClearKey(false);
    setShow(false);
    setModelsError('');
  };

  const addAccount = () => {
    const id = `p${Date.now().toString(36)}`;
    setS((prev) => ({
      ...prev,
      accounts: [...prev.accounts, { id, label: '新提供商', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', models: [] }],
    }));
    selectAccount(id);
  };

  const removeAccount = (id: string) => {
    const index = s.accounts.findIndex((item) => item.id === id);
    if (index < 0) return;
    const accounts = s.accounts.filter((item) => item.id !== id);
    if (!accounts.length) {
      setAccountId('');
      setKey('');
      setClearKey(false);
      setShow(false);
      setModelsError('');
      setS((prev) => ({
        ...prev,
        accounts,
        activeProviderId: '',
        model: prev.route === 'api' ? '' : prev.model,
      }));
      return;
    }
    const active = accounts.find((item) => item.id === s.activeProviderId) ?? accounts[Math.min(index, accounts.length - 1)];
    const stillSelected = accounts.some((item) => item.id === accountId);
    setS((prev) => ({
      ...prev,
      accounts,
      activeProviderId: active.id,
      provider: active.provider,
      baseUrl: active.baseUrl,
      model: prev.route === 'api' ? active.model : prev.model,
    }));
    if (!stillSelected) selectAccount(active.id);
  };

  const useAccount = () => {
    if (!account) return;
    setS((prev) => ({
      ...prev,
      route: 'api',
      activeProviderId: account.id,
      provider: account.provider,
      baseUrl: account.baseUrl,
      model: account.model,
    }));
    setProviderView('network');
  };

  const save = () => {
    const draft = clearKey ? '' : key.trim() ? key.trim() : undefined;
    const update: SettingsUpdate = { settings: s };
    if (account && account.id === s.activeProviderId) update.apiKey = draft;
    else if (account && draft !== undefined) update.apiKeys = { [account.id]: draft };
    onSave(update);
  };

  const pullModels = async () => {
    if (!account) return;
    setListing(true);
    setModelsError('');
    try {
      const listed = await window.api.models.list({
        provider: account.provider,
        baseUrl: account.baseUrl,
        accountId: account.id,
        apiKey: clearKey ? '' : key.trim() ? key.trim() : undefined,
      });
      const ids = listed.map((m) => m.id);
      patchAccount(account.id, { models: ids, model: account.model || ids[0] || '' });
      if (!ids.length) setModelsError('接口没有返回模型');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setModelsError(msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setListing(false);
    }
  };

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal settings-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="设置">
        <nav className="settings-nav">
          <div className="settings-nav-title">设置</div>
          <button type="button" className={page === 'general' ? 'active' : ''} onClick={() => setPage('general')}>
            一般
          </button>
          <button
            type="button"
            className={page === 'personal' ? 'active' : ''}
            data-testid="settings-personal"
            onClick={() => setPage('personal')}
          >
            字体
          </button>
          <button
            type="button"
            className={page === 'provider' ? 'active' : ''}
            data-testid="settings-provider"
            onClick={() => setPage('provider')}
          >
            提供商
          </button>
        </nav>
        <div className="settings-main">
          <div className="settings-body">
            {page === 'general' ? (
              <>
                <div className="settings-field">
                  <div className="settings-label">界面模式</div>
                  <div className="theme-choices" role="radiogroup" aria-label="界面模式">
                    {THEMES.map((t) => (
                      <button
                        type="button"
                        key={t.id}
                        role="radio"
                        aria-checked={s.theme === t.id}
                        className={s.theme === t.id ? 'active' : ''}
                        onClick={() => set('theme', t.id)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="settings-field">
                  <div className="settings-label">数据目录</div>
                  <div className="row data-dir-row">
                    <input readOnly value={dataDir} title={dataDir} data-testid="data-dir" aria-label="数据目录" />
                    <button type="button" className="sm" disabled={dirBusy} onClick={() => void changeDataDir()}>
                      {dirBusy ? '更换中…' : '更改'}
                    </button>
                    <button type="button" className="sm" onClick={() => void window.api.data.openDataFolder()}>
                      打开
                    </button>
                  </div>
                  {dirError && <div className="field-error">{dirError}</div>}
                  <p className="hint">会话、设置和 API Key 保存在这个文件夹。更改后立即生效。</p>
                </div>
              </>
            ) : page === 'personal' ? (
              <>
                <FontPicker
                  label="英文字体"
                  name="fontLatin"
                  value={s.fontLatin}
                  options={fontChoices('latin', s.fontLatin, installedFonts)}
                  onChange={(v) => set('fontLatin', v)}
                />
                <FontPicker
                  label="中文字体"
                  name="fontCjk"
                  value={s.fontCjk}
                  options={fontChoices('cjk', s.fontCjk, installedFonts)}
                  onChange={(v) => set('fontCjk', v)}
                />
                <p className="hint">点击输入框展开字体列表，输入即可搜索，也可以直接填写字体族名称。西文用英文字体，汉字用中文字体。留空保存后会回到默认字体。</p>
                <div className="font-preview">
                  <div>The quick brown fox jumps over the lazy dog.</div>
                  <div>追问，划选文字，展开一支新的探索。</div>
                </div>
              </>
            ) : page === 'provider' ? (
              <>
                <div className="source-switch" role="radiogroup" aria-label="提供商来源">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={providerView === 'network'}
                    className={providerView === 'network' ? 'active' : ''}
                    data-testid="settings-network"
                    onClick={() => {
                      setProviderView('network');
                      setS((prev) => {
                        const active = prev.accounts.find((item) => item.id === prev.activeProviderId) ?? prev.accounts[0];
                        return {
                          ...prev,
                          route: 'api',
                          provider: active?.provider ?? prev.provider,
                          baseUrl: active?.baseUrl ?? prev.baseUrl,
                          model: active?.model ?? '',
                        };
                      });
                    }}
                  >
                    网络提供商
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={providerView === 'cli'}
                    className={providerView === 'cli' ? 'active' : ''}
                    data-testid="settings-cli"
                    onClick={() => setProviderView('cli')}
                  >
                    本地 CLI
                  </button>
                </div>
                {providerView === 'cli' ? (
                  <CliSettings
                    route={s.route}
                    model={s.model}
                    cliModels={s.cliModels}
                    onPick={(id, model) => setS((prev) => ({ ...prev, route: id, model }))}
                    onModels={(id: CliId, models) => setS((prev) => ({ ...prev, cliModels: { ...prev.cliModels, [id]: models } }))}
                  />
                ) : (
              <>
                <div className="account-bar">
                  {s.accounts.map((item) => (
                    <span className="account-chip" key={item.id}>
                      <button
                        type="button"
                        className={`chip ${item.id === account?.id ? 'active' : ''}`}
                        onClick={() => selectAccount(item.id)}
                      >
                        {item.label || '未命名'}{item.id === s.activeProviderId ? ' · 当前' : ''}
                      </button>
                      <button
                        type="button"
                        className="account-x"
                        aria-label={`删除${item.label || '提供商'}`}
                        onClick={() => removeAccount(item.id)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <button type="button" className="chip" onClick={addAccount}>添加</button>
                </div>
                {account ? (
              <>
                <p className="hint">
                  可以保存多个云端接口。请求由本机应用的主进程直接发出，不经过任何第三方服务器。{STORAGE_NOTE[settings.keyStorage]}
                </p>
                <div className="presets">
                  {PRESETS.map((p) => (
                    <button
                      type="button"
                      key={p.label}
                      className={`chip ${account.baseUrl === p.baseUrl && account.provider === p.provider ? 'active' : ''}`}
                      onClick={() => {
                        patchAccount(account.id, { label: p.label, provider: p.provider, baseUrl: p.baseUrl, model: p.model, models: [] });
                        setModelsError('');
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <label>
                  名称
                  <input value={account.label} onChange={(e) => patchAccount(account.id, { label: e.target.value })} />
                </label>
                <label>
                  接口协议
                  <select
                    value={account.provider}
                    onChange={(e) => {
                      patchAccount(account.id, { provider: e.target.value as Provider, models: [] });
                      setModelsError('');
                    }}
                  >
                    <option value="openai">OpenAI 兼容（/chat/completions）</option>
                    <option value="anthropic">Anthropic（/messages）</option>
                  </select>
                </label>
                <label>
                  <span>
                    API Key {settings.accountKeys[account.id] && !clearKey && <span className="ok-tag">已保存</span>}
                  </span>
                  <div className="row">
                    <input
                      name="apiKey"
                      type={show ? 'text' : 'password'}
                      value={key}
                      disabled={clearKey}
                      onChange={(e) => setKey(e.target.value)}
                      placeholder={settings.accountKeys[account.id] ? '已保存（留空则保持不变）' : 'sk-...'}
                      autoComplete="off"
                    />
                    <button type="button" className="sm" onClick={() => setShow(!show)}>
                      {show ? '隐藏' : '显示'}
                    </button>
                    {settings.accountKeys[account.id] && (
                      <button type="button" className="sm" onClick={() => setClearKey(!clearKey)}>
                        {clearKey ? '撤销' : '清除'}
                      </button>
                    )}
                  </div>
                </label>
                <label>
                  Base URL
                  <input
                    name="baseUrl"
                    value={account.baseUrl}
                    onChange={(e) => {
                      patchAccount(account.id, { baseUrl: e.target.value, models: [] });
                      setModelsError('');
                    }}
                  />
                </label>
                <label>
                  模型名称
                  <div className="row">
                    <input name="model" value={account.model} onChange={(e) => patchAccount(account.id, { model: e.target.value })} />
                    <button type="button" className="sm" onClick={() => void pullModels()} disabled={listing} data-testid="list-models">
                      {listing ? '拉取中…' : '拉取模型'}
                    </button>
                  </div>
                </label>
                {modelsError && <div className="field-error">{modelsError}</div>}
                {!!account.models.length && (
                  <div className="model-list" data-testid="model-list">
                    {account.models.map((id) => (
                      <button type="button" key={id} className={id === account.model ? 'active' : ''} onClick={() => patchAccount(account.id, { model: id })}>
                        {id}
                      </button>
                    ))}
                  </div>
                )}
                {account.id !== s.activeProviderId && (
                  <div className="row">
                    <button type="button" className="sm" onClick={useAccount}>用于对话</button>
                  </div>
                )}
                <label>
                  Temperature：{s.temperature}
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.1}
                    value={s.temperature}
                    onChange={(e) => set('temperature', Number(e.target.value))}
                  />
                </label>
                <label>
                  系统提示词
                  <textarea rows={3} value={s.systemPrompt} onChange={(e) => set('systemPrompt', e.target.value)} />
                </label>
              </>
                ) : (
                  <p className="hint">还没有云端提供商。点「添加」新建一个。</p>
                )}
              </>
                )}
              </>
            ) : null}
          </div>
          <div className="modal-foot">
            <button type="button" onClick={onClose}>
              取消
            </button>
            <button type="button" className="primary" onClick={save}>
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ipcMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

function FontPicker({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const queryRef = useRef(query);
  const valueRef = useRef(value);
  const optionsRef = useRef(options);
  const onChangeRef = useRef(onChange);
  const settled = useRef(false);
  queryRef.current = query;
  valueRef.current = value;
  optionsRef.current = options;
  onChangeRef.current = onChange;

  const q = (query ?? '').trim().toLowerCase();
  const shown = query ? options.filter((f) => f.toLowerCase().includes(q)) : options;
  const cursor = shown.length ? Math.min(active, shown.length - 1) : 0;
  const listId = `${name}-list`;

  const finish = (apply: string | null) => {
    if (settled.current) return;
    settled.current = true;
    queryRef.current = null;
    if (apply !== null) {
      const text = apply.trim();
      if (text !== valueRef.current) onChangeRef.current(text);
    }
    setQuery(null);
    setOpen(false);
  };

  const dismiss = () => {
    if (settled.current) return;
    const typed = queryRef.current;
    if (typed === null) {
      finish(null);
      return;
    }
    const needle = typed.trim().toLowerCase();
    const matches = needle ? optionsRef.current.filter((f) => f.toLowerCase().includes(needle)) : [];
    if (!needle || matches.length === 0) finish(typed);
    else finish(null);
  };

  const reveal = () => {
    settled.current = false;
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) dismiss();
    };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('.font-list button') ?? [])];
    const i = buttons.findIndex((b) => b.getAttribute('aria-selected') === 'true');
    if (i >= 0) setActive(i);
    buttons[i >= 0 ? i : 0]?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector('.font-list button.hot')?.scrollIntoView({ block: 'nearest' });
  }, [open, cursor, query]);

  return (
    <div className="settings-field">
      <div className="settings-label" id={`${name}-label`}>{label}</div>
      <div className="font-combo" ref={root}>
        <div className="font-combo-field">
          <input
            name={name}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-labelledby={`${name}-label`}
            value={query ?? value}
            placeholder="搜索或填写字体"
            onFocus={reveal}
            onClick={reveal}
            onChange={(e) => {
              settled.current = false;
              setQuery(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onBlur={(e) => {
              if (root.current?.contains(e.relatedTarget as Node)) return;
              dismiss();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                finish(null);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                reveal();
                setActive((i) => Math.min(i + 1, Math.max(shown.length - 1, 0)));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                reveal();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const typed = queryRef.current;
                if (typed !== null && typed.trim() === '') finish('');
                else if (shown.length) finish(shown[cursor]);
                else finish(typed ?? value);
              }
            }}
          />
          <button
            type="button"
            className="font-combo-toggle"
            tabIndex={-1}
            aria-label={open ? `收起${label}列表` : `展开${label}列表`}
            aria-expanded={open}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (open) dismiss();
              else {
                setQuery(null);
                reveal();
                root.current?.querySelector('input')?.focus();
              }
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        {open && (
          <div className="font-list" id={listId} role="listbox" aria-label={label} data-testid={listId}>
            {shown.map((f, i) => (
              <button
                type="button"
                key={f}
                role="option"
                aria-selected={f === value}
                className={`${f === value ? 'active' : ''} ${i === cursor ? 'hot' : ''}`}
                style={{ fontFamily: `"${sanitizeFont(f, 'sans-serif')}"` }}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => finish(f)}
              >
                {f}
              </button>
            ))}
            {!shown.length && <p className="hint">没有匹配的字体，回车采用输入的名称</p>}
          </div>
        )}
      </div>
    </div>
  );
}
