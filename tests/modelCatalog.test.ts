import { describe, expect, it } from 'vitest';
import { claudeContextWindows, claudeModelIds, codexModelIds, codexModelWindows, grokModelIds, modelGroups } from '../src/shared/modelCatalog';
import type { CloudAccount } from '../src/shared/types';

const account = (patch: Partial<CloudAccount>): CloudAccount => ({
  id: 'default',
  label: 'DeepSeek',
  provider: 'openai',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-flash',
  models: ['deepseek-flash', 'deepseek-chat'],
  ...patch,
});

describe('model catalogs', () => {
  it('reads Claude model names and skips tokens', () => {
    const ids = claudeModelIds({
      model: 'fable',
      modelSettings: { 'claude-opus-5': { effortLevel: 'high' } },
      env: {
        ANTHROPIC_AUTH_TOKEN: 'sk-secret',
        ANTHROPIC_MODEL: 'claude-haiku-4-5',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5',
        ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: 'Sonnet 5',
      },
    });
    expect(ids).toEqual(['fable', 'claude-opus-5', 'claude-haiku-4-5', 'claude-sonnet-5']);
    expect(claudeContextWindows({
      model: 'fable',
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-opus-5-5[1M]',
        ANTHROPIC_MODEL: 'claude-haiku-4-5',
      },
    })).toEqual({ fable: 1_000_000, 'claude-opus-5-5[1M]': 1_000_000, 'claude-haiku-4-5': 200_000 });
  });

  it('reads Codex slugs and context windows', () => {
    const catalog = { models: [{ slug: 'gpt-6.1-sol', context_window: 272000 }, { slug: 'gpt-6-sol' }, { name: 'nope' }] };
    expect(codexModelIds(catalog)).toEqual(['gpt-6.1-sol', 'gpt-6-sol']);
    expect(codexModelWindows(catalog)).toEqual({ 'gpt-6.1-sol': 272000 });
  });

  it('reads Grok bullets', () => {
    const text = 'You are logged in.\nAvailable models:\n* grok-4.7 (default)\n- grok-4.6\n';
    expect(grokModelIds(text)).toEqual(['grok-4.7', 'grok-4.6']);
  });

  it('puts cloud accounts and local CLIs in one list', () => {
    const groups = modelGroups({
      accounts: [account({}), account({ id: 'other', label: 'OpenAI', model: 'gpt-4o-mini', models: [] })],
      cliModels: { grok: ['grok-4.7'] },
      cliConfigured: { claude: 'fable' },
      cliInstalled: { claude: true, codex: false, grok: true },
    });
    expect(groups.map((group) => group.label)).toEqual(['DeepSeek', 'OpenAI', 'Claude Code', 'Grok']);
    expect(groups[0].models).toContain('deepseek-chat');
    expect(groups[2].models).toEqual(['fable']);
    expect(groups[3].route).toBe('grok');
  });
});
