import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { asRoute, formatCliPrompt } from '../shared/cli';
import { COMPACT_SYSTEM } from '../shared/context';
import type { AppData, ChatEvent, ChatRequest, ModelListRequest, SettingsUpdate, ThemeMode } from '../shared/types';
import { applyNativeTheme } from './appearance';
import { listClis, listCliModels, listCliWindows, streamCli } from './cli';
import { currentDataDir } from './dataDir';
import { pickTextFiles } from './files';
import { listModels, streamChat } from './llm';
import { getApiKey, getApiKeyFor, inspectDataDir, loadData, loadSettings, saveData, saveDataSync, saveSettings, setDataDirectory, settingsState } from './store';

const controllers = new Map<string, AbortController>();

function isAppData(d: unknown): d is AppData {
  return !!d && typeof d === 'object' && 'sessions' in d && 'nodes' in d;
}

export function registerIpc() {
  ipcMain.handle('data:load', () => loadData());
  ipcMain.handle('data:save', (_e, d: unknown) => {
    if (isAppData(d)) return saveData(d);
  });
  ipcMain.on('data:saveSync', (e, d: unknown) => {
    try {
      if (isAppData(d)) saveDataSync(d);
    } finally {
      e.returnValue = true;
    }
  });

  ipcMain.handle('data:export', async (e, json: unknown, defaultName: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender)!;
    const r = await dialog.showSaveDialog(win, {
      title: '导出对话',
      defaultPath: typeof defaultName === 'string' ? defaultName : 'keepasking.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return null;
    await writeFile(r.filePath, String(json), 'utf8');
    return r.filePath;
  });

  ipcMain.handle('data:import', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!;
    const r = await dialog.showOpenDialog(win, {
      title: '导入对话',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return readFile(r.filePaths[0], 'utf8');
  });

  ipcMain.handle('data:openFolder', () => shell.openPath(currentDataDir()).then(() => undefined));
  ipcMain.handle('data:getDir', () => currentDataDir());
  ipcMain.handle('data:chooseDir', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win!, {
      title: '选择数据目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return r.filePaths[0];
  });
  ipcMain.handle('data:inspectDir', (_e, dir: unknown) => {
    if (typeof dir !== 'string') throw new Error('请选择文件夹');
    return inspectDataDir(dir);
  });
  ipcMain.handle('data:setDir', (_e, dir: unknown, mode: unknown) => {
    if (typeof dir !== 'string') throw new Error('请选择文件夹');
    if (mode !== 'move' && mode !== 'switch') throw new Error('无法更换数据目录');
    return setDataDirectory(dir, mode);
  });

  ipcMain.handle('settings:get', () => settingsState());
  ipcMain.on('settings:peek', (e) => {
    e.returnValue = settingsState();
  });
  ipcMain.handle('settings:save', (_e, u: SettingsUpdate) => saveSettings(u));
  ipcMain.handle('appearance:apply', (_e, theme: ThemeMode) => applyNativeTheme(theme));

  ipcMain.handle('models:list', async (_e, req: ModelListRequest) => {
    const provider = req?.provider === 'anthropic' ? 'anthropic' : 'openai';
    const baseUrl = String(req?.baseUrl ?? '');
    const apiKey = typeof req?.apiKey === 'string' ? req.apiKey.trim() : getApiKeyFor(req?.accountId);
    if (!apiKey && !/localhost|127\.0\.0\.1/.test(baseUrl)) throw new Error('请先填写 API Key');
    try {
      return await listModels(provider, baseUrl, apiKey);
    } catch (err: unknown) {
      let msg = err instanceof Error ? err.message : String(err);
      const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : '';
      if (/fetch failed/i.test(msg)) msg = `网络错误：无法连接到 Base URL${cause ? `（${cause}）` : ''}`;
      throw new Error(msg);
    }
  });

  ipcMain.handle('cli:list', () => listClis());
  ipcMain.handle('cli:models', (_e, id: unknown) => {
    if (id !== 'claude' && id !== 'codex' && id !== 'grok') throw new Error('未知的本地 CLI');
    return listCliModels(id);
  });
  ipcMain.handle('cli:windows', () => listCliWindows());
  ipcMain.handle('files:pick', (e) => pickTextFiles(BrowserWindow.fromWebContents(e.sender)));

  ipcMain.handle('chat:start', (e, req: ChatRequest) => {
    const body = req ?? ({} as ChatRequest);
    const { requestId, messages } = body;
    if (typeof requestId !== 'string' || !Array.isArray(messages)) throw new Error('invalid request');
    const sender = e.sender;
    const send = (ev: ChatEvent) => {
      if (!sender.isDestroyed()) sender.send('chat:event', ev);
    };
    const ac = new AbortController();
    controllers.set(requestId, ac);
    const clean = messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => ({ role: m.role, content: String(m.content ?? '') }));
    const saved = loadSettings();
    const account = saved.accounts.find((item) => item.id === saved.activeProviderId) ?? saved.accounts[0];
    const compact = body.purpose === 'compact';
    const settings = compact
      ? {
          ...saved,
          provider: account?.provider ?? saved.provider,
          baseUrl: account?.baseUrl ?? saved.baseUrl,
          model: account?.model || (saved.route === 'api' ? saved.model : ''),
          systemPrompt: COMPACT_SYSTEM,
          thinkingEffort: 'off' as const,
          temperature: 0.2,
        }
      : { ...saved, provider: account?.provider ?? saved.provider, baseUrl: account?.baseUrl ?? saved.baseUrl };
    const route = compact ? 'api' : asRoute(body.route ?? saved.route);
    const run = route === 'api'
      ? streamChat(settings, getApiKey(), clean, (text) => send({ requestId, type: 'delta', text }), ac.signal)
      : streamCli(route, formatCliPrompt(settings.systemPrompt, clean), saved.model, (text) => send({ requestId, type: 'delta', text }), ac.signal);
    // Fire and forget: progress is reported through chat:event
    void run
      .then(() => send({ requestId, type: 'done' }))
      .catch((err: unknown) => {
        const aborted = ac.signal.aborted;
        let msg = err instanceof Error ? err.message : String(err);
        const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : '';
        if (/fetch failed/i.test(msg)) msg = `网络错误：无法连接到 Base URL${cause ? `（${cause}）` : ''}`;
        send({ requestId, type: 'error', error: aborted ? '已停止' : msg, aborted });
      })
      .finally(() => controllers.delete(requestId));
  });

  ipcMain.on('chat:abort', (_e, requestId: string) => controllers.get(requestId)?.abort());
}
