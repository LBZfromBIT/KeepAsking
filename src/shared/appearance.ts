export type ThemeMode = 'light' | 'dark' | 'system';

export const DEFAULT_FONT_LATIN = 'Segoe UI';
export const DEFAULT_FONT_CJK = 'Microsoft YaHei';

/** One installed font family. Strips characters that could break out of a CSS font name. */
export function sanitizeFont(raw: unknown, fallback: string): string {
  const s = String(raw ?? '')
    .replace(/[^\p{L}\p{N} ._-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
  return s || fallback;
}

export function resolvedTheme(mode: ThemeMode, prefersDark: boolean): 'light' | 'dark' {
  if (mode === 'light') return 'light';
  if (mode === 'dark') return 'dark';
  return prefersDark ? 'dark' : 'light';
}
