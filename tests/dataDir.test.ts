import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pickDataDir, samePath } from '../src/shared/dataDir';
import { removeDataFiles, transferDataFiles } from '../src/main/transfer';

describe('pickDataDir', () => {
  it('uses the saved folder only when it is absolute and present', () => {
    const exists = (dir: string) => samePath(dir, 'D:/keep/data');
    expect(pickDataDir('D:/default', null, exists)).toBe('D:/default');
    expect(pickDataDir('D:/default', { dataDir: 'notes' }, exists)).toBe('D:/default');
    expect(pickDataDir('D:/default', { dataDir: 'D:/missing' }, exists)).toBe('D:/default');
    expect(samePath(pickDataDir('D:/default', { dataDir: 'D:/keep/data' }, exists), 'D:/keep/data')).toBe(true);
    expect(samePath(pickDataDir('D:/keep/data', { dataDir: 'D:/keep/data/' }, () => true), 'D:/keep/data')).toBe(true);
  });
});

describe('transferDataFiles', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('copies the data files and can remove the sources afterwards', () => {
    const from = mkdtempSync(join(tmpdir(), 'keepasking-from-'));
    const to = mkdtempSync(join(tmpdir(), 'keepasking-to-'));
    dirs.push(from, to);
    writeFileSync(join(from, 'data.json'), '{"version":1}');
    writeFileSync(join(from, 'settings.json'), '{}');
    writeFileSync(join(from, 'apikey.bin'), 'legacy');
    writeFileSync(join(from, 'provider-keys.bin'), 'accounts');
    writeFileSync(join(from, 'location.json'), '{"dataDir":"nope"}');
    const copied = transferDataFiles(from, to);
    expect(copied).toEqual(['data.json', 'settings.json', 'apikey.bin', 'provider-keys.bin']);
    expect(readFileSync(join(to, 'data.json'), 'utf8')).toBe('{"version":1}');
    expect(readFileSync(join(to, 'provider-keys.bin'), 'utf8')).toBe('accounts');
    expect(() => readFileSync(join(to, 'location.json'))).toThrow();
    removeDataFiles(from, copied);
    expect(() => readFileSync(join(from, 'data.json'))).toThrow();
    expect(() => readFileSync(join(from, 'provider-keys.bin'))).toThrow();
    expect(readFileSync(join(from, 'location.json'), 'utf8')).toContain('nope');
  });
});
