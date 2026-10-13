export const LATIN_FONTS = ['Segoe UI', 'Inter', 'Arial', 'Georgia', 'Palatino Linotype', 'Consolas', 'Cascadia Mono'];
export const CJK_FONTS = ['Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', 'Source Han Sans SC', 'Sarasa Gothic SC', '霞鹜文楷'];

const CJK_NAME =
  /cjk|source han|sarasa|yahei|pingfang|simsun|simhei|kaiti|fangsong|dengxian|jhenghei|hiragino|heiti|songti|wenquanyi|noto (?:sans|serif).*(?:sc|tc|jp|kr|hk|cjk)|yu gothic|yu mincho|meiryo|malgun|ms gothic|ms mincho|mingliu/i;

export function isCjkFont(family: string): boolean {
  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(family)) return true;
  return CJK_NAME.test(family);
}

/** Curated families first, then installed ones. The current value stays visible even if it is not installed. */
export function fontChoices(kind: 'latin' | 'cjk', current: string, installed: string[]): string[] {
  const curated = kind === 'latin' ? LATIN_FONTS : CJK_FONTS;
  const fromSystem = installed.filter((f) => (kind === 'cjk' ? isCjkFont(f) : !isCjkFont(f)));
  const all = [...curated, ...fromSystem];
  const trimmed = current.trim();
  if (trimmed && !all.some((f) => f.toLowerCase() === trimmed.toLowerCase())) all.unshift(trimmed);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of all) {
    const key = f.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}
