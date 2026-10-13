import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pickDataDir, samePath } from '../shared/dataDir';

let defaultDir = '';
let activeDir = '';

/** Call once before the app is ready. Tests set BRANCHCHAT_USER_DATA and skip the saved folder. */
export function initDataDir() {
  app.setName('KeepAsking');
  if (process.env.BRANCHCHAT_USER_DATA) {
    app.setPath('userData', process.env.BRANCHCHAT_USER_DATA);
    defaultDir = process.env.BRANCHCHAT_USER_DATA;
    activeDir = process.env.BRANCHCHAT_USER_DATA;
    return;
  }
  defaultDir = app.getPath('userData');
  activeDir = defaultDir;
  let pointer: unknown = null;
  try {
    pointer = JSON.parse(readFileSync(join(defaultDir, 'location.json'), 'utf8'));
  } catch {
    pointer = null;
  }
  const chosen = pickDataDir(defaultDir, pointer, existsSync);
  activeDir = chosen;
  if (!samePath(chosen, defaultDir)) app.setPath('userData', chosen);
}

export function currentDataDir(): string {
  return activeDir || app.getPath('userData');
}

export function setActiveDataDir(dir: string) {
  activeDir = dir;
  try {
    app.setPath('userData', dir);
  } catch {
    // After startup Electron may refuse to retarget userData. File reads use currentDataDir.
  }
}

/** The pointer stays in the default folder so the next launch can find a relocated directory. */
export function writeDataPointer(dir: string) {
  if (!defaultDir) return;
  const file = join(defaultDir, 'location.json');
  if (samePath(dir, defaultDir)) {
    if (existsSync(file)) unlinkSync(file);
    return;
  }
  mkdirSync(defaultDir, { recursive: true });
  writeFileSync(file, JSON.stringify({ dataDir: dir }));
}
