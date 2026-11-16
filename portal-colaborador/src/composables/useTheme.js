// portal-colaborador/src/composables/useTheme.js
// =============================================================================
// Gestão de Tema (Claro / Escuro / Sistema) e Personalização Whitelabel AA
// =============================================================================

import { computed, onMounted, ref } from 'vue';

const THEME_KEY = 'nexus_portal_theme';
const DEFAULT_BRAND = '#0C5CAB';
const DEFAULT_BRAND_DARK = '#0A4A8A';
const DEFAULT_TEXT_DARK = '#60a5fa';
const DARK_TEXT_SURFACE = '#27272a';
const LIGHT_SURFACE = '#ffffff';

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));

const hslToRgb = (h, s, l) => {
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const light = Math.max(0, Math.min(100, l)) / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: clamp(f(0) * 255), g: clamp(f(8) * 255), b: clamp(f(4) * 255) };
};

const rgbToHsl = ({ r, g, b }) => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: (h / 6) * 360, s: s * 100, l: l * 100 };
};

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

  const rgb = color.match(/^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)/i);
  if (rgb) {
    const channel = (v) => (v.endsWith('%') ? (parseFloat(v) / 100) * 255 : parseFloat(v));
    return { r: clamp(channel(rgb[1])), g: clamp(channel(rgb[2])), b: clamp(channel(rgb[3])) };
  }

  const hsl = color.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i);
  if (hsl) {
    const hue = ((parseFloat(hsl[1]) % 360) + 360) % 360;
    return hslToRgb(hue, parseFloat(hsl[2]), parseFloat(hsl[3]));
  }

  return null;
};

export const toHex = ({ r, g, b }) =>
  `#${((clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).padStart(6, '0')}`;

export const rgbChannels = (value) => {
  const c = typeof value === 'string' ? parseColor(value) : value;
  return c ? `${clamp(c.r)} ${clamp(c.g)} ${clamp(c.b)}` : null;
};

export const darken = (value, amount = 0.19) => {
  const c = parseColor(value);
  if (!c) return null;
  const scale = (v) => v * (1 - amount);
  return toHex({ r: scale(c.r), g: scale(c.g), b: scale(c.b) });
};

export const lighten = (value, amount = 0.18) => {
  const c = parseColor(value);
  if (!c) return null;
  const mix = (v) => v + (255 - v) * amount;
  return toHex({ r: mix(c.r), g: mix(c.g), b: mix(c.b) });
};

export const luminance = (value) => {
  const c = typeof value === 'string' ? parseColor(value) : value;
  if (!c) return null;
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
};

export const hoverShade = (value) => {
  const lum = luminance(value);
  if (lum === null) return DEFAULT_BRAND_DARK;
  return lum < 0.03 ? lighten(value, 0.18) : darken(value, 0.19);
};

export const contrastRatio = (a, b) => {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
};

export const pickContrastFg = (bgColor) => {
  const lightFg = '#fafafa';
  const darkFg = '#09090b';
  const crLight = contrastRatio(bgColor, lightFg) ?? 0;
  const crDark = contrastRatio(bgColor, darkFg) ?? 0;
  return crLight >= crDark ? lightFg : darkFg;
};

export const ensureContrastOnSurface = (brandColor, surfaceHex, minRatio = 4.5) => {
  const c = parseColor(brandColor);
  const s = parseColor(surfaceHex);
  if (!c || !s) return DEFAULT_BRAND;

  const hex = toHex(c);
  if ((contrastRatio(c, s) ?? 0) >= minRatio) return hex;

  const surfaceIsDark = (luminance(s) ?? 0) < 0.179;
  const targetRatio = Math.min(21, minRatio + 0.45);
  const { h, s: sat, l: baseL } = rgbToHsl(c);

  let lo = surfaceIsDark ? baseL : 2;
  let hi = surfaceIsDark ? 96 : baseL;
  let best = null;

  for (let i = 0; i < 20; i += 1) {
    const mid = (lo + hi) / 2;
    const candidate = hslToRgb(h, sat, mid);
    const ratio = contrastRatio(candidate, s) ?? 0;
    if (ratio >= targetRatio) {
      best = candidate;
      if (surfaceIsDark) hi = mid;
      else lo = mid;
    } else if (surfaceIsDark) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  if (best && (contrastRatio(best, s) ?? 0) >= minRatio) {
    return toHex(best);
  }

  return surfaceIsDark ? '#fafafa' : '#09090b';
};

const prefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

const theme = ref(
  (typeof window !== 'undefined' && localStorage.getItem(THEME_KEY)) || 'system',
);

function resolveEffective(mode) {
  if (mode === 'system') return prefersDark() ? 'dark' : 'light';
  return mode === 'dark' ? 'dark' : 'light';
}

const effectiveTheme = ref(resolveEffective(theme.value));

function applyThemeDom(mode) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const isDark = mode === 'dark';

  root.classList.toggle('dark', isDark);
  root.classList.toggle('light', !isDark);
  root.style.colorScheme = mode;
  effectiveTheme.value = mode;
}

function updateTheme() {
  const target = resolveEffective(theme.value);
  applyThemeDom(target);
}

export function applyBranding(colorCandidate) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const parsed = parseColor(colorCandidate);
  const brand = parsed ? toHex(parsed) : DEFAULT_BRAND;
  const brandDark = parsed ? hoverShade(brand) || DEFAULT_BRAND_DARK : DEFAULT_BRAND_DARK;
  const channels = rgbChannels(brand) || '12 92 171';
  const darkChannels = rgbChannels(brandDark) || '10 74 138';
  const fg = pickContrastFg(brand);
  const fgChannels = rgbChannels(fg) || '250 250 250';
  const textLight = ensureContrastOnSurface(brand, LIGHT_SURFACE, 4.5);
  const textDark = parsed
    ? ensureContrastOnSurface(brand, DARK_TEXT_SURFACE, 4.5)
    : DEFAULT_TEXT_DARK;
  const ringLight = ensureContrastOnSurface(brand, LIGHT_SURFACE, 3.5);
  const ringDark = parsed
    ? ensureContrastOnSurface(brand, DARK_TEXT_SURFACE, 3.5)
    : DEFAULT_TEXT_DARK;

  root.style.setProperty('--color-brand', brand);
  root.style.setProperty('--color-brand-dark', brandDark);
  root.style.setProperty('--color-brand-rgb', channels);
  root.style.setProperty('--color-brand-dark-rgb', darkChannels);
  root.style.setProperty('--color-brand-fg', fg);
  root.style.setProperty('--color-brand-fg-rgb', fgChannels);
  root.style.setProperty('--color-brand-text-light', textLight);
  root.style.setProperty('--color-brand-text-dark', textDark);
  root.style.setProperty('--color-brand-ring-light', ringLight);
  root.style.setProperty('--color-brand-ring-dark', ringDark);
  root.style.setProperty('--color-brand-ring-light-rgb', rgbChannels(ringLight) || '12 92 171');
  root.style.setProperty('--color-brand-ring-dark-rgb', rgbChannels(ringDark) || '96 165 250');
}

// Inicialização imediata sem esperar onMounted para evitar FOUC
if (typeof window !== 'undefined') {
  updateTheme();
  applyBranding();
  try {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', () => {
      if (theme.value === 'system') updateTheme();
    });
  } catch {
    // legacy fallback
  }
}

export function useTheme() {
  const isDark = computed(() => effectiveTheme.value === 'dark');

  function setTheme(next) {
    theme.value = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // ignore
    }
    updateTheme();
  }

  function toggleTheme() {
    setTheme(isDark.value ? 'light' : 'dark');
  }

  onMounted(() => {
    updateTheme();
  });

  return {
    theme,
    effectiveTheme,
    isDark,
    setTheme,
    toggleTheme,
    applyBranding,
  };
}
