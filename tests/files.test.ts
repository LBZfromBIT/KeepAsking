import { describe, expect, it } from 'vitest';
import { decodeTextFile } from '../src/shared/files';

describe('decodeTextFile', () => {
  it('reads utf-8 text', () => {
    expect(decodeTextFile('a.txt', new TextEncoder().encode('你好')).text).toBe('你好');
  });

  it('rejects binary and oversized files', () => {
    expect(() => decodeTextFile('a.png', Uint8Array.from([1, 0, 2]))).toThrow(/二进制/);
    expect(() => decodeTextFile('big.txt', new Uint8Array(200_001))).toThrow(/过大/);
  });
});
