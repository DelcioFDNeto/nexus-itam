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
    return { r: clamp(channel(rgb[1])), g: clamp(channel(rgb[2])), b: clamp(channel(rgb[3])) };
  }

  const hsl = color.match(/^hsla?\(\s*([\d.]+)(?:deg)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i);
  if (hsl) return hslToRgb(parseFloat(hsl[1]) % 360, parseFloat(hsl[2]), parseFloat(hsl[3]));

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
