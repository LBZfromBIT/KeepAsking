import { spawn, execFile, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI_LABEL, cliInvocation, emptyCliParse, readCliEvent, type CliId } from '../shared/cli';
import { claudeContextWindows, claudeModelIds, codexModelIds, codexModelWindows, grokModelIds } from '../shared/modelCatalog';
import type { CliInfo } from '../shared/types';

const HOME_CANDIDATES: Record<CliId, string[]> = {
  claude: [join(homedir(), '.local', 'bin', 'claude.exe'), join(homedir(), '.local', 'bin', 'claude')],
  codex: [
    join(process.env.APPDATA ?? '', 'npm', 'codex.cmd'),
    join(process.env.APPDATA ?? '', 'npm', 'codex.exe'),
  ],
  grok: [join(homedir(), '.grok', 'bin', 'grok.exe'), join(homedir(), '.grok', 'bin', 'grok')],
};

function firstExisting(paths: string[]): string {
  return paths.find((path) => path && existsSync(path)) ?? '';
}

function whereCommand(name: string): Promise<string> {
  const which = process.platform === 'win32' ? 'where.exe' : 'which';
  return new Promise((resolve) => {
    execFile(which, [name], { windowsHide: true, timeout: 4000 }, (err, stdout) => {
      if (err) return resolve('');
      const lines = String(stdout)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const preferred = lines.find((line) => !/\.(ps1|bat)$/i.test(line));
      resolve(preferred || lines[0] || '');
    });
  });
}

async function resolveCommand(id: CliId): Promise<string> {
  const known = firstExisting(HOME_CANDIDATES[id]);
  if (known) return known;
  const found = await whereCommand(id);
  if (/\.ps1$/i.test(found)) {
    const cmd = found.replace(/\.ps1$/i, '.cmd');
    if (existsSync(cmd)) return cmd;
  }
  return found;
}

/** Node on Windows rejects spawn() of a .cmd or .bat file with EINVAL. */
function quoteCmd(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function spawnCommand(command: string, args: string[], options: SpawnOptions): ChildProcess {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
    const inner = [command, ...args].map(quoteCmd).join(' ');
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${inner}"`], {
      ...options,
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
  }
  return spawn(command, args, { ...options, windowsHide: true });
}

function commandVersion(command: string): Promise<string> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnCommand(command, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve('');
      return;
    }
    let out = '';
    const timer = setTimeout(() => {
      killTree(child);
      resolve('');
    }, 8000);
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve('');
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(out.trim().split(/\r?\n/)[0]?.trim() ?? '');
    });
  });
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function tomlValue(text: string, key: string): string {
  const match = text.match(new RegExp(`^${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s#]+))`, 'm'));
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
}

function fileHasBody(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).size > 2;
  } catch {
    return false;
  }
}

function profile(id: CliId): { model: string; signedIn: boolean } {
  const home = homedir();
  if (id === 'claude') {
    const settings = readJson(join(home, '.claude', 'settings.json'));
    const model = typeof settings?.model === 'string' ? settings.model : '';
    const env = settings?.env && typeof settings.env === 'object' ? (settings.env as Record<string, unknown>) : {};
    const hasEnvKey = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'].some((key) => typeof env[key] === 'string' && String(env[key]).trim());
    return { model, signedIn: hasEnvKey || fileHasBody(join(home, '.claude', '.credentials.json')) };
  }
  if (id === 'codex') {
    let model = '';
    try {
      model = tomlValue(readFileSync(join(home, '.codex', 'config.toml'), 'utf8'), 'model');
    } catch {
      model = '';
    }
    return { model, signedIn: fileHasBody(join(home, '.codex', 'auth.json')) };
  }
  let model = '';
  try {
    model = tomlValue(readFileSync(join(home, '.grok', 'config.toml'), 'utf8'), 'model');
  } catch {
    model = '';
  }
  return { model, signedIn: fileHasBody(join(home, '.grok', 'auth.json')) };
}

function describe(info: Omit<CliInfo, 'detail'>): string {
  if (!info.installed) return '未安装';
  const bits = ['已安装'];
  if (info.version) bits.push(info.version);
  bits.push(info.model ? `模型 ${info.model}` : '配置里没有模型名');
  bits.push(info.signedIn ? '已登录' : '未检测到登录');
  return bits.join(' · ');
}

export async function listClis(): Promise<CliInfo[]> {
  const ids: CliId[] = ['claude', 'codex', 'grok'];
  const found = await Promise.all(ids.map(async (id) => ({ id, command: await resolveCommand(id) })));
  return Promise.all(
    found.map(async ({ id, command }) => {
      const installed = !!command;
      const { model, signedIn } = profile(id);
      const version = installed ? await commandVersion(command) : '';
      const base = { id, label: CLI_LABEL[id], installed, version, command, model, signedIn };
      return { ...base, detail: describe(base) };
    }),
  );
}

function killTree(child: ChildProcess) {
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
    return;
  }
  child.kill();
}

function capture(command: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawnCommand(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      killTree(child);
      finish(() => reject(new Error('读取模型列表超时')));
    }, 20000);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-2000);
    });
    child.on('error', (err) => finish(() => reject(err)));
    child.on('close', (code) => finish(() => resolve({ code, stdout, stderr })));
  });
}

export async function listCliModels(id: CliId): Promise<string[]> {
  if (id === 'claude') {
    const ids = claudeModelIds(readJson(join(homedir(), '.claude', 'settings.json')));
    if (!ids.length) throw new Error('没有从 Claude Code 的配置里读到模型名');
    return ids;
  }
  const command = await resolveCommand(id);
  if (!command) throw new Error(`${CLI_LABEL[id]} 未安装，或没有出现在 PATH 中`);
  const args = id === 'codex' ? ['debug', 'models', '--bundled'] : ['models'];
  const { code, stdout, stderr } = await capture(command, args);
  const ids = id === 'codex' ? codexIds(stdout) : grokModelIds(stdout);
  if (!ids.length) {
    const tail = stderr.trim().split(/\r?\n/).slice(-4).join(' ');
    throw new Error(tail || (code ? `${CLI_LABEL[id]} 退出码 ${code}` : '没有读到模型'));
  }
  return ids;
}

function codexPayload(stdout: string): unknown {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(stdout.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

function codexIds(stdout: string): string[] {
  return codexModelIds(codexPayload(stdout));
}

/** Context windows for the local CLIs. Missing tools contribute nothing. */
export async function listCliWindows(): Promise<Record<string, number>> {
  const out: Record<string, number> = claudeContextWindows(readJson(join(homedir(), '.claude', 'settings.json')));
  const command = await resolveCommand('codex');
  if (!command) return out;
  try {
    const { stdout } = await capture(command, ['debug', 'models', '--bundled']);
    for (const [id, tokens] of Object.entries(codexModelWindows(codexPayload(stdout)))) out[id] = tokens;
  } catch {
    // The renderer still has name-based windows when the catalog cannot be read.
  }
  return out;
}

export async function streamCli(
  id: CliId,
  prompt: string,
  model: string,
  onDelta: (text: string) => void,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    const err = new Error('已停止');
    err.name = 'AbortError';
    throw err;
  }
  const command = await resolveCommand(id);
  if (!command) throw new Error(`${CLI_LABEL[id]} 未安装，或没有出现在 PATH 中`);
  const dir = await mkdtemp(join(tmpdir(), 'keepasking-cli-'));
  const promptPath = join(dir, 'prompt.txt');
  await writeFile(promptPath, prompt, 'utf8');
  const spec = cliInvocation(id, promptPath, dir, model);
  const child = spawnCommand(command, spec.args, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  const state = emptyCliParse();
  let stderr = '';
  let pending = '';
  let failure = '';
  const onAbort = () => killTree(child);
  signal.addEventListener('abort', onAbort, { once: true });

  const takeLine = (line: string) => {
    const event = readCliEvent(id, line, state);
    if (event.error) failure = event.error;
    if (event.text) onDelta(event.text);
  };

  child.stdout?.on('data', (chunk: Buffer) => {
    pending += chunk.toString('utf8');
    let nl = pending.indexOf('\n');
    while (nl >= 0) {
      takeLine(pending.slice(0, nl));
      pending = pending.slice(nl + 1);
      nl = pending.indexOf('\n');
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString('utf8')).slice(-2000);
  });

  try {
    if (spec.stdin) {
      child.stdin?.write(prompt);
      child.stdin?.end();
    } else {
      child.stdin?.end();
    }
    const code = await new Promise<number | null>((resolve, reject) => {
      let settled = false;
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      });
      child.on('close', (exit) => {
        if (settled) return;
        settled = true;
        resolve(exit);
      });
    });
    if (pending.trim()) takeLine(pending);
    if (signal.aborted) {
      const err = new Error('已停止');
      err.name = 'AbortError';
      throw err;
    }
    if (failure && !state.sawText) throw new Error(failure);
    if (code && !state.sawText) {
      const tail = stderr.trim().split(/\r?\n/).slice(-4).join(' ');
      throw new Error(tail || `${CLI_LABEL[id]} 退出码 ${code}`);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    await rm(dir, { recursive: true, force: true });
  }
}
