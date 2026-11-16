import { describe, it, expect } from 'vitest';
import {
  contrastRatio,
  darken,
  ensureContrastOnSurface,
  parseColor,
  pickContrastFg,
  rgbChannels,
} from './color';

describe('parseColor', () => {
  it('entende hex curto, longo e com alfa', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor('#0C5CAB')).toEqual({ r: 12, g: 92, b: 171 });
    expect(parseColor('#0C5CAB80')).toEqual({ r: 12, g: 92, b: 171 });
  });

  it('entende rgb() e hsl()', () => {
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30 });
    expect(parseColor('hsl(0, 100%, 50%)')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('recusa o que nao e cor', () => {
    expect(parseColor('url(https://evil.tld)')).toBeNull();
    expect(parseColor('rgb(., ., .)')).toBeNull();
    expect(parseColor('hsl(., .%, .%)')).toBeNull();
    expect(rgbChannels('rgb(., ., .)')).toBeNull();
    expect(parseColor(undefined)).toBeNull();
  });
});

describe('derivados da marca', () => {
  it('gera canais para o Tailwind', () => {
    expect(rgbChannels('#0C5CAB')).toBe('12 92 171');
  });

  it('escurece rgb/hsl sem cair em preto', () => {
    // Regressao: o darken antigo so entendia hex e devolvia #000000 para rgb().
    expect(darken('rgb(200, 100, 50)')).not.toBe('#000000');
    expect(darken('#ffffff')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('mede contraste para avisar marcas claras demais', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
    expect(contrastRatio('#FDE047', '#ffffff')).toBeLessThan(3);
    expect(contrastRatio('#0C5CAB', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('pickContrastFg', () => {
  it('escolhe #fafafa para fundos escuros e #09090b para fundos claros', () => {
    expect(pickContrastFg('#0C5CAB')).toBe('#fafafa');
    expect(pickContrastFg('#047857')).toBe('#fafafa');
    expect(pickContrastFg('#000000')).toBe('#fafafa');
    expect(pickContrastFg('#FDE047')).toBe('#09090b');
    expect(pickContrastFg('#ffffff')).toBe('#09090b');
  });

  it('retorna #fafafa como fallback seguro para entrada invalida', () => {
    expect(pickContrastFg(null)).toBe('#fafafa');
    expect(pickContrastFg('not-a-color')).toBe('#fafafa');
  });
});

describe('ensureContrastOnSurface', () => {
  it('preserva e normaliza via toHex quando ja atinge contraste minimo', () => {
    expect(ensureContrastOnSurface('#0C5CAB', '#ffffff', 4.5)).toBe('#0c5cab');
    expect(ensureContrastOnSurface('rgb(12, 92, 171)', '#ffffff', 4.5)).toBe('#0c5cab');
    expect(ensureContrastOnSurface('hsl(210, 87%, 36%)', '#ffffff', 4.5)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('escurece marca clara sobre superficie clara ate atingir >= 4.5:1', () => {
    const adjusted = ensureContrastOnSurface('#FDE047', '#ffffff', 4.5);
    expect(adjusted).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrastRatio(adjusted, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('clareia marca escura sobre superficie escura ate atingir >= 4.5:1', () => {
    const adjusted = ensureContrastOnSurface('#0C5CAB', '#111113', 4.5);
    expect(adjusted).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrastRatio(adjusted, '#111113')).toBeGreaterThanOrEqual(4.5);
  });

  it('garante contraste quando marca e superficie sao identicas nos extremos', () => {
    const onWhite = ensureContrastOnSurface('#ffffff', '#ffffff');
    const onBlack = ensureContrastOnSurface('#000000', '#000000');
    expect(onWhite).toMatch(/^#[0-9a-f]{6}$/);
    expect(onBlack).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrastRatio(onWhite, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(onBlack, '#000000')).toBeGreaterThanOrEqual(4.5);
  });

  it('retorna null quando a cor de marca e invalida', () => {
    expect(ensureContrastOnSurface('javascript:alert(1)', '#ffffff')).toBeNull();
  });
});
