export interface MathBlock {
  display: boolean;
  tex: string;
}

const mathToken = (i: number) => `MATHTOKEN${i}END`;
const codeToken = (i: number) => `CODETOKEN${i}END`;

/** Inline `$...$` that is a formula, not a price like `$5` or `$10`. */
export function isInlineTex(inner: string): boolean {
  if (!inner || inner.length > 800) return false;
  if (/^[\d.,]+$/.test(inner)) return false;
  if (/\s/.test(inner) && !/[\\^_{}=]/.test(inner)) return false;
  return true;
}

/**
 * Pull math out of Markdown before the parser can treat `_`, `\` and `$` as formatting.
 * Fenced and inline code are left untouched.
 */
export function shieldMath(src: string): { text: string; blocks: MathBlock[] } {
  const blocks: MathBlock[] = [];
  const codes: string[] = [];
  const take = (display: boolean, tex: string) => {
    blocks.push({ display, tex: tex.trim() });
    return mathToken(blocks.length - 1);
  };
  const mask = (chunk: string) => {
    codes.push(chunk);
    return codeToken(codes.length - 1);
  };
  let text = src.replace(/```[\s\S]*?```/g, (chunk) => mask(chunk));
  text = text.replace(/`[^`\n]+`/g, (chunk) => mask(chunk));
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_full, tex: string) => take(true, tex));
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_full, tex: string) => take(true, tex));
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_full, tex: string) => take(false, tex));
  text = text.replace(/(^|[^\\$])\$(?!\$)([^\s$](?:[^$\n]*?[^\s$])?)\$(?!\$)/g, (full, pre: string, inner: string) => {
    if (!isInlineTex(inner)) return full;
    return pre + take(false, inner);
  });
  text = text.replace(/CODETOKEN(\d+)END/g, (_full, i: string) => codes[Number(i)] ?? '');
  return { text, blocks };
}

export function mathPlaceholder(i: number): string {
  return mathToken(i);
}
