import { BrowserWindow, nativeTheme } from 'electron';
import type { ThemeMode } from '../shared/appearance';

const DARK_BG = '#1c1b19';
const LIGHT_BG = '#faf9f5';

export function applyNativeTheme(theme: ThemeMode) {
  const mode: ThemeMode = theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'dark';
  nativeTheme.themeSource = mode;
  const bg = nativeTheme.shouldUseDarkColors ? DARK_BG : LIGHT_BG;
  for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(bg);
}

export const windowBackground = () => (nativeTheme.shouldUseDarkColors ? DARK_BG : LIGHT_BG);
