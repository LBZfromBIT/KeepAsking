function slash(p: string): string {
  return p.replace(/[\\/]+/g, '/').replace(/\/+$/, '');
}

export function samePath(a: string, b: string): boolean {
  const left = slash(a);
  const right = slash(b);
  const windows = /^[a-zA-Z]:/.test(left) || /^[a-zA-Z]:/.test(right);
  return windows ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function isAbsolutePath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\');
}

/** Startup choice: use a saved folder only when it is absolute and still exists. */
export function pickDataDir(defaultDir: string, pointer: unknown, exists: (dir: string) => boolean): string {
  const raw = pointer && typeof pointer === 'object' && 'dataDir' in pointer ? (pointer as { dataDir: unknown }).dataDir : null;
  if (typeof raw !== 'string' || !raw.trim() || !isAbsolutePath(raw.trim())) return defaultDir;
  const chosen = raw.trim();
  if (samePath(chosen, defaultDir) || !exists(chosen)) return defaultDir;
  return chosen;
}
