import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import type { AppData, ChatEvent, ChatRequest, SettingsUpdate } from '../shared/types';
import { streamChat } from './llm';
import { getApiKey, loadData, loadSettings, saveData, saveDataSync, saveSettings, settingsState } from './store';

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
      defaultPath: typeof defaultName === 'string' ? defaultName : 'branch-chat.json',
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

  ipcMain.handle('data:openFolder', () => shell.openPath(app.getPath('userData')).then(() => undefined));

  ipcMain.handle('settings:get', () => settingsState());
  ipcMain.handle('settings:save', (_e, u: SettingsUpdate) => saveSettings(u));

  ipcMain.handle('chat:start', (e, req: ChatRequest) => {
    const { requestId, messages } = req ?? ({} as ChatRequest);
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
    // Fire and forget: progress is reported through chat:event
    void streamChat(loadSettings(), getApiKey(), clean, (text) => send({ requestId, type: 'delta', text }), ac.signal)
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
