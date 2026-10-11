import { useState } from 'react';
import type { Provider, Settings, SettingsState, SettingsUpdate } from '../../../shared/types';

interface Props {
  settings: SettingsState;
  onSave: (u: SettingsUpdate) => void;
  onClose: () => void;
}

const PRESETS: { label: string; provider: Provider; baseUrl: string; model: string }[] = [
  { label: 'OpenAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: 'DeepSeek', provider: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: 'OpenRouter', provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  { label: 'xAI', provider: 'openai', baseUrl: 'https://api.x.ai/v1', model: 'grok-3-mini' },
  { label: 'Ollama 本地', provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5' },
  { label: 'Anthropic', provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5' },
];

const STORAGE_NOTE: Record<SettingsState['keyStorage'], string> = {
  os: 'API Key 已通过系统钥匙串（Keychain / DPAPI / libsecret）加密保存在本机。',
  basic_text: '未检测到系统密钥环（如 gnome-keyring / KWallet），Key 仅做了弱加密。建议安装密钥环服务。',
  unavailable: '系统加密不可用，无法保存 API Key。',
};

export function SettingsModal({ settings, onSave, onClose }: Props) {
  const [s, setS] = useState<Settings>({
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    systemPrompt: settings.systemPrompt,
    temperature: settings.temperature,
  });
  const [key, setKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [show, setShow] = useState(false);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v }));

  const save = () => onSave({ settings: s, apiKey: clearKey ? '' : key.trim() ? key.trim() : undefined });

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="设置">
        <h2>设置 · 自带 API Key（BYOK）</h2>
        <p className="hint">
          请求由本机应用的主进程直接发往你填写的 API 地址，不经过任何第三方服务器。{STORAGE_NOTE[settings.keyStorage]}
        </p>
        <div className="presets">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              className={`chip ${s.baseUrl === p.baseUrl && s.provider === p.provider ? 'active' : ''}`}
              onClick={() => setS((prev) => ({ ...prev, provider: p.provider, baseUrl: p.baseUrl, model: p.model }))}
            >
              {p.label}
            </button>
          ))}
        </div>
        <label>
          接口协议
          <select value={s.provider} onChange={(e) => set('provider', e.target.value as Provider)}>
            <option value="openai">OpenAI 兼容（/chat/completions）</option>
            <option value="anthropic">Anthropic（/messages）</option>
          </select>
        </label>
        <label>
          API Key {settings.hasApiKey && !clearKey && <span className="ok-tag">已保存</span>}
          <div className="row">
            <input
              name="apiKey"
              type={show ? 'text' : 'password'}
              value={key}
              disabled={clearKey}
              onChange={(e) => setKey(e.target.value)}
              placeholder={settings.hasApiKey ? '已保存（留空则保持不变）' : 'sk-...'}
              autoComplete="off"
            />
            <button className="sm" onClick={() => setShow(!show)}>{show ? '隐藏' : '显示'}</button>
            {settings.hasApiKey && (
              <button className="sm" onClick={() => setClearKey(!clearKey)}>{clearKey ? '撤销' : '清除'}</button>
            )}
          </div>
        </label>
        <label>
          Base URL
          <input name="baseUrl" value={s.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} />
        </label>
        <label>
          模型名称
          <input name="model" value={s.model} onChange={(e) => set('model', e.target.value)} />
        </label>
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
        <div className="modal-foot">
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>
  );
}
