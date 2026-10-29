import { copyFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export const DATA_FILES = ['data.json', 'settings.json', 'apikey.bin', 'provider-keys.bin'] as const;

/** Copy the data files. The caller deletes the sources only after the new location is recorded. */
export function transferDataFiles(from: string, to: string): string[] {
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of DATA_FILES) {
    const src = join(from, name);
    if (!existsSync(src)) continue;
    copyFileSync(src, join(to, name));
    copied.push(name);
  }
  return copied;
}

export function removeDataFiles(dir: string, names: readonly string[]) {
  for (const name of names) {
    const file = join(dir, name);
    if (existsSync(file)) unlinkSync(file);
  }
}
