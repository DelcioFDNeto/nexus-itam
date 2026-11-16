// src/utils/color.js
// -----------------------------------------------------------------------------
// Conversoes da cor de marca (whitelabel). O Tailwind so consegue aplicar
// opacidade (`bg-brand/10`, `shadow-brand/30`...) quando a cor e declarada em
// canais RGB; com `var(--color-brand)` puro essas classes nem eram geradas.
// -----------------------------------------------------------------------------

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));

const hslToRgb = (h, s, l) => {
  const sat = s / 100;
  const light = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: clamp(f(0) * 255), g: clamp(f(8) * 255), b: clamp(f(4) * 255) };
};

/** Aceita #rgb, #rrggbb (com ou sem alfa), rgb()/rgba() e hsl()/hsla(). */
export const parseColor = (value) => {
  if (typeof value !== 'string') return null;
  const color = value.trim();

  const hex = color.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    let digits = hex[1];
    if (digits.length <= 4) digits = digits.split('').map((c) => c + c).join('');
    const n = parseInt(digits.slice(0, 6), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  const rgb = color.match(/^rgba?\(\s*([\d.]+%?)\s*,\s*([\d.]+%?)\s*,\s*([\d.]+%?)/i);
  if (rgb) {
    const channel = (v) => (v.endsWith('%') ? (parseFloat(v) / 100) * 255 : parseFloat(v));
    const r = channel(rgb[1]);
    const g = channel(rgb[2]);
    const b = channel(rgb[3]);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
    return { r: clamp(r), g: clamp(g), b: clamp(b) };
  }

  const hsl = color.match(/^hsla?\(\s*([\d.]+)(?:deg)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i);
  if (hsl) {
    const h = parseFloat(hsl[1]);
    const s = parseFloat(hsl[2]);
    const l = parseFloat(hsl[3]);
    if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) return null;
    const out = hslToRgb(h % 360, s, l);
    return Number.isFinite(out.r) && Number.isFinite(out.g) && Number.isFinite(out.b) ? out : null;
  }

  return null;
};

export const toHex = ({ r, g, b }) =>
  `#${((clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).padStart(6, '0')}`;

/** Canais no formato que o Tailwind consome: "79 70 229". */
export const rgbChannels = (value) => {
  const c = parseColor(value);
  return c ? `${c.r} ${c.g} ${c.b}` : null;
};

/** Escurece a cor para o tom de hover/pressed. Sempre devolve hex. */
export const darken = (value, amount = 0.14) => {
  const c = parseColor(value);
  if (!c) return null;
  const scale = (v) => v * (1 - amount);
  return toHex({ r: scale(c.r), g: scale(c.g), b: scale(c.b) });
};

const luminance = ({ r, g, b }) => {
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/** Razao de contraste WCAG entre duas cores (1..21). */
export const contrastRatio = (a, b) => {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return null;
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const DARK_INK = '#09090b';
const LIGHT_INK = '#fafafa';

/** Escolhe '#09090b' ou '#fafafa' maximizando o contraste WCAG sobre `bgColor`. */
export const pickContrastFg = (bgColor) => {
  const darkContrast = contrastRatio(bgColor, DARK_INK);
  const lightContrast = contrastRatio(bgColor, LIGHT_INK);
  if (darkContrast === null || lightContrast === null) return LIGHT_INK;
  return darkContrast > lightContrast ? DARK_INK : LIGHT_INK;
};

/**
 * Garante contraste minimo `minRatio` para `brandColor` usado como texto sobre `surfaceHex`.
 * Normaliza hex/rgb/hsl via `parseColor` -> `toHex` e mistura gradualmente em direcao a
 * tinta de maior contraste da superficie ate atingir o alvo WCAG.
 */
export const ensureContrastOnSurface = (brandColor, surfaceHex, minRatio = 4.5) => {
  const base = parseColor(brandColor);
  if (!base) return null;

  const baseHex = toHex(base);
  const surface = parseColor(surfaceHex);
  if (!surface) return baseHex;

  const surfaceNorm = toHex(surface);
  const targetRatio = Number.isFinite(minRatio) && minRatio > 1 ? minRatio : 4.5;
  if ((contrastRatio(baseHex, surfaceNorm) || 0) >= targetRatio) return baseHex;

  const targetInk = parseColor(pickContrastFg(surfaceNorm));
  const steps = 200;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const candidateHex = toHex({
      r: base.r + (targetInk.r - base.r) * t,
      g: base.g + (targetInk.g - base.g) * t,
      b: base.b + (targetInk.b - base.b) * t,
    });
    if ((contrastRatio(candidateHex, surfaceNorm) || 0) >= targetRatio) {
      return candidateHex;
    }
  }

  return toHex(targetInk);
};
