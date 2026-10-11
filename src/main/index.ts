import { app, BrowserWindow, Menu, shell } from 'electron';
import { join } from 'node:path';
import icon from '../../resources/icon.png?asset';
import { registerIpc } from './ipc';

// Allow tests / portable setups to redirect the data directory
if (process.env.BRANCHCHAT_USER_DATA) app.setPath('userData', process.env.BRANCHCHAT_USER_DATA);

app.setName('BranchChat');

const isSafeExternal = (url: string) => /^(https?:|mailto:)/i.test(url);

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: '分支对话',
    backgroundColor: '#f7f7f5',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  win.on('ready-to-show', () => win.show());

  // Every link that tries to open a new window goes to the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // Block in-app navigation away from the renderer (e.g. clicking a markdown link)
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) {
      e.preventDefault();
      if (isSafeExternal(url)) void shell.openExternal(url);
    }
  });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });

  app.whenReady().then(() => {
    if (process.platform === 'darwin') {
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          { role: 'appMenu' },
          { role: 'editMenu' },
          { role: 'viewMenu' },
          { role: 'windowMenu' },
        ]),
      );
    }
    // Deny all permission requests (camera, mic, notifications...) — not needed
    app.on('web-contents-created', (_e, wc) => {
      wc.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    });
    registerIpc();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
