import type { Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { resolvedTheme, sanitizeFont } from '../../shared/appearance';
import darkHljs from 'highlight.js/styles/github-dark-dimmed.css?inline';
import lightHljs from 'highlight.js/styles/github.css?inline';

let hljsEl: HTMLStyleElement | null = null;

/** Apply theme and UI fonts on the document, and tell the main process so the window frame matches. */
export function applyAppearance(s: Pick<Settings, 'theme' | 'fontLatin' | 'fontCjk'>) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = resolvedTheme(s.theme, prefersDark);
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.style.setProperty('--font-latin', `"${sanitizeFont(s.fontLatin, DEFAULT_SETTINGS.fontLatin)}"`);
  root.style.setProperty('--font-cjk', `"${sanitizeFont(s.fontCjk, DEFAULT_SETTINGS.fontCjk)}"`);
  if (!hljsEl) {
    hljsEl = document.createElement('style');
    hljsEl.id = 'hljs-theme';
    document.head.appendChild(hljsEl);
  }
  hljsEl.textContent = theme === 'dark' ? darkHljs : lightHljs;
  void window.api?.settings.applyAppearance(s.theme);
}
