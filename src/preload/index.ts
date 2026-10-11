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
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (u) => ipcRenderer.invoke('settings:save', u),
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
