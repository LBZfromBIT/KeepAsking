import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { BranchChatApi, ChatEvent } from '../shared/types';

const api: BranchChatApi = {
  platform: process.platform,
  data: {
    load: () => ipcRenderer.invoke('data:load'),
    save: (d) => ipcRenderer.invoke('data:save', d),
    saveSync: (d) => void ipcRenderer.sendSync('data:saveSync', d),
    exportToFile: (json, name) => ipcRenderer.invoke('data:export', json, name),
    importFromFile: () => ipcRenderer.invoke('data:import'),
    openDataFolder: () => ipcRenderer.invoke('data:openFolder'),
    getDir: () => ipcRenderer.invoke('data:getDir'),
    chooseDir: () => ipcRenderer.invoke('data:chooseDir'),
    inspectDir: (dir) => ipcRenderer.invoke('data:inspectDir', dir),
    setDir: (dir, mode) => ipcRenderer.invoke('data:setDir', dir, mode),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    peek: () => ipcRenderer.sendSync('settings:peek'),
    save: (u) => ipcRenderer.invoke('settings:save', u),
    applyAppearance: (theme) => ipcRenderer.invoke('appearance:apply', theme),
  },
  models: {
    list: (req) => ipcRenderer.invoke('models:list', req),
  },
  cli: {
    list: () => ipcRenderer.invoke('cli:list'),
    models: (id) => ipcRenderer.invoke('cli:models', id),
    windows: () => ipcRenderer.invoke('cli:windows'),
  },
  files: {
    pick: () => ipcRenderer.invoke('files:pick'),
  },
  chat: {
    start: (req) => ipcRenderer.invoke('chat:start', req),
    abort: (id) => ipcRenderer.send('chat:abort', id),
    onEvent: (cb) => {
      const fn = (_e: IpcRendererEvent, ev: ChatEvent) => cb(ev);
      ipcRenderer.on('chat:event', fn);
      return () => void ipcRenderer.removeListener('chat:event', fn);
    },
  },
};

contextBridge.exposeInMainWorld('api', api);
