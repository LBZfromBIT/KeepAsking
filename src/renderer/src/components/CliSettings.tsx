import { useEffect, useState } from 'react';
import { CLI_LABEL, type CliId } from '../../../shared/cli';
import type { ChatRoute, CliInfo } from '../../../shared/types';

const ORDER: CliId[] = ['claude', 'codex', 'grok'];

export function CliSettings({
  route,
  model,
  cliModels,
  onPick,
  onModels,
}: {
  route: ChatRoute;
  model: string;
  cliModels: Partial<Record<CliId, string[]>>;
  onPick: (id: CliId, model: string) => void;
  onModels: (id: CliId, models: string[]) => void;
}) {
  const [tools, setTools] = useState<CliInfo[] | null>(null);
  const [error, setError] = useState('');
  const [pulling, setPulling] = useState<CliId | null>(null);
  const [pullError, setPullError] = useState('');

  useEffect(() => {
    let live = true;
    window.api.cli
      .list()
      .then((list) => {
        if (live) setTools(list);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, []);

  const byId = new Map((tools ?? []).map((tool) => [tool.id, tool]));

  const pull = async (id: CliId) => {
    setPullError('');
    setPulling(id);
    try {
      onModels(id, await window.api.cli.models(id));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setPullError(msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setPulling(null);
    }
  };

  return (
    <>
      <p className="hint">
        读取本机的 Claude Code、Codex 和 Grok。选中后，这一条对话由对应命令完成，并使用它自己的登录状态。密钥不会进入界面。
      </p>
      {pullError && <p className="field-error">{pullError}</p>}
      {ORDER.map((id) => {
        const tool = byId.get(id);
        const models = cliModels[id] ?? [];
        const current = route === id ? model : '';
        return (
          <div className="cli-card" key={id}>
            <div className="cli-card-head">
              <strong>{CLI_LABEL[id]}</strong>
              <span className="row">
                <button type="button" className="sm" disabled={tool ? !tool.installed || pulling === id : true} onClick={() => void pull(id)}>
                  {pulling === id ? '拉取中…' : '拉取模型'}
                </button>
                <button
                  type="button"
                  className={`sm ${route === id ? 'primary' : ''}`}
                  disabled={tool ? !tool.installed : true}
                  onClick={() => onPick(id, current || models[0] || tool?.model || '')}
                >
                  {route === id ? '使用中' : '用它对话'}
                </button>
              </span>
            </div>
            <p className="hint">{error && !tool ? error : tool?.detail ?? '正在读取…'}</p>
            {!!models.length && (
              <div className="model-list">
                {models.map((item) => (
                  <button type="button" key={item} className={current === item ? 'active' : ''} onClick={() => onPick(id, item)}>
                    {item}
                  </button>
                ))}
              </div>
            )}
            {tool?.command && <p className="cli-path">{tool.command}</p>}
          </div>
        );
      })}
    </>
  );
}


