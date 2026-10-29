import { describe, expect, it } from 'vitest';
import { cliInvocation, emptyCliParse, formatCliPrompt, readCliEvent } from '../src/shared/cli';

describe('cli prompt and flags', () => {
  it('puts the transcript in the prompt and keeps the command line free of it', () => {
    const prompt = formatCliPrompt('用中文', [
      { role: 'user', content: '问题' },
      { role: 'assistant', content: '回答' },
    ]);
    expect(prompt).toContain('系统说明：');
    expect(prompt).toContain('用户：');
    expect(prompt).toContain('问题');
    expect(prompt).toContain('不要修改文件');
    const claude = cliInvocation('claude', 'C:\\temp\\prompt.txt', 'C:\\temp');
    const codex = cliInvocation('codex', 'C:\\temp\\prompt.txt', 'C:\\temp');
    const grok = cliInvocation('grok', 'C:\\temp\\prompt.txt', 'C:\\temp');
    expect(claude.stdin).toBe(true);
    expect(claude.args.join(' ')).not.toContain('问题');
    expect(codex.args).toContain('read-only');
    expect(grok.args).toContain('C:\\temp\\prompt.txt');
    expect(grok.stdin).toBe(false);
    expect(cliInvocation('claude', 'C:\\temp\\prompt.txt', 'C:\\temp', 'fable').args).toContain('fable');
    expect(cliInvocation('codex', 'C:\\temp\\prompt.txt', 'C:\\temp', 'gpt-6-sol').args).toContain('-m');
    expect(cliInvocation('grok', 'C:\\temp\\prompt.txt', 'C:\\temp', 'grok-4.7').args).toContain('--model');
  });
});

describe('cli event parsers', () => {
  it('streams Claude text deltas and ignores the repeated final result', () => {
    const state = emptyCliParse();
    const first = readCliEvent(
      'claude',
      JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '你' } } }),
      state,
    );
    const second = readCliEvent('claude', JSON.stringify({ type: 'result', result: '你好' }), state);
    expect(first.text).toBe('你');
    expect(second.text).toBe('');
  });

  it('uses the Claude result when no deltas arrived', () => {
    const event = readCliEvent('grok', JSON.stringify({ type: 'result', result: '全文' }), emptyCliParse());
    expect(event.text).toBe('全文');
  });

  it('emits only the new suffix of a Codex message', () => {
    const state = emptyCliParse();
    const updated = readCliEvent('codex', JSON.stringify({ type: 'item.updated', item: { id: '1', type: 'agent_message', text: '你' } }), state);
    const done = readCliEvent('codex', JSON.stringify({ type: 'item.completed', item: { id: '1', type: 'agent_message', text: '你好' } }), state);
    expect(updated.text).toBe('你');
    expect(done.text).toBe('好');
  });

  it('surfaces a Codex failure', () => {
    const event = readCliEvent('codex', JSON.stringify({ type: 'error', message: '未登录' }), emptyCliParse());
    expect(event.error).toBe('未登录');
  });
});
