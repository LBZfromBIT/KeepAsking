import { describe, expect, it } from 'vitest';
import { fontChoices, isCjkFont } from '../src/shared/fonts';

describe('font lists', () => {
  it('splits installed families into Latin and CJK lists', () => {
    expect(isCjkFont('Microsoft YaHei')).toBe(true);
    expect(isCjkFont('霞鹜文楷')).toBe(true);
    expect(isCjkFont('Segoe UI')).toBe(false);
    const installed = ['Segoe UI', 'Microsoft YaHei', 'Georgia', 'PingFang SC'];
    expect(fontChoices('latin', 'Segoe UI', installed)).toContain('Georgia');
    expect(fontChoices('latin', 'Segoe UI', installed)).not.toContain('PingFang SC');
    expect(fontChoices('cjk', 'Microsoft YaHei', installed)).toContain('PingFang SC');
    expect(fontChoices('cjk', 'Microsoft YaHei', installed)).not.toContain('Georgia');
  });

  it('keeps a custom family at the top of the list', () => {
    expect(fontChoices('latin', 'Iosevka', [])[0]).toBe('Iosevka');
  });
});
