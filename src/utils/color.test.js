import { describe, it, expect } from 'vitest';
import { contrastRatio, darken, parseColor, rgbChannels } from './color';

describe('parseColor', () => {
  it('entende hex curto, longo e com alfa', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor('#4F46E5')).toEqual({ r: 79, g: 70, b: 229 });
    expect(parseColor('#4F46E580')).toEqual({ r: 79, g: 70, b: 229 });
  });

  it('entende rgb() e hsl()', () => {
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30 });
    expect(parseColor('hsl(0, 100%, 50%)')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('recusa o que nao e cor', () => {
    expect(parseColor('url(https://evil.tld)')).toBeNull();
    expect(parseColor(undefined)).toBeNull();
  });
});

describe('derivados da marca', () => {
  it('gera canais para o Tailwind', () => {
    expect(rgbChannels('#4F46E5')).toBe('79 70 229');
  });

  it('escurece rgb/hsl sem cair em preto', () => {
    // Regressao: o darken antigo so entendia hex e devolvia #000000 para rgb().
    expect(darken('rgb(200, 100, 50)')).not.toBe('#000000');
    expect(darken('#ffffff')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('mede contraste para avisar marcas claras demais', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
    expect(contrastRatio('#FDE047', '#ffffff')).toBeLessThan(3);
  });
});
