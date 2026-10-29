import { describe, expect, it } from 'vitest';
import katex from 'katex';
import { isInlineTex, mathPlaceholder, shieldMath } from '../src/shared/math';

describe('shieldMath', () => {
  it('keeps formulas out of the markdown source and leaves code alone', () => {
    const src = '行内 $E=mc^2$，块级 $$a^2+b^2=c^2$$，以及 `$E=mc^2$` 和\n```\n$not math$\n```';
    const { text, blocks } = shieldMath(src);
    expect(blocks.map((block) => block.tex)).toEqual(['a^2+b^2=c^2', 'E=mc^2']);
    expect(text).toContain(mathPlaceholder(0));
    expect(text).toContain(mathPlaceholder(1));
    expect(text).toContain('`$E=mc^2$`');
    expect(text).toContain('$not math$');
  });

  it('does not treat prices as math', () => {
    const { blocks } = shieldMath('价格是 $5 和 $10。');
    expect(blocks).toEqual([]);
    expect(isInlineTex('5')).toBe(false);
  });

  it('keeps a spaced formula that uses TeX markers', () => {
    const { blocks } = shieldMath('能量 $E = mc^2$。');
    expect(blocks[0]?.tex).toBe('E = mc^2');
  });

  it('renders display and inline delimiters', () => {
    const { blocks } = shieldMath('行内 \\(x_i\\) 与 \\[\\int_a^b x\\,dx\\]');
    expect(blocks).toEqual([
      { display: true, tex: '\\int_a^b x\\,dx' },
      { display: false, tex: 'x_i' },
    ]);
    expect(katex.renderToString('E=mc^2', { throwOnError: false, output: 'html' })).toContain('katex');
  });
});
