import { describe, expect, it } from 'vitest';
import { resolvedTheme, sanitizeFont } from '../src/shared/appearance';

describe('appearance', () => {
  it('resolves system theme from the OS preference', () => {
    expect(resolvedTheme('light', true)).toBe('light');
    expect(resolvedTheme('dark', false)).toBe('dark');
    expect(resolvedTheme('system', true)).toBe('dark');
    expect(resolvedTheme('system', false)).toBe('light');
  });

  it('keeps a single font family and drops css breakout characters', () => {
    expect(sanitizeFont('  PingFang SC  ', 'fallback')).toBe('PingFang SC');
    expect(sanitizeFont('霞鹜文楷', 'fallback')).toBe('霞鹜文楷');
    expect(sanitizeFont('Segoe UI"; color:red', 'fallback')).toBe('Segoe UI colorred');
    expect(sanitizeFont('   ', 'Segoe UI')).toBe('Segoe UI');
  });
});
