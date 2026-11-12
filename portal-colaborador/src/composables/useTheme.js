// portal-colaborador/src/composables/useTheme.js
// =============================================================================
// Gestão de Tema (Claro / Escuro / Sistema) e Personalização Whitelabel
// =============================================================================

import { computed, onMounted, ref } from 'vue';

const THEME_KEY = 'nexus_portal_theme';
const DEFAULT_BRAND = '#4F46E5';

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));

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

  return null;
};

export const toHex = ({ r, g, b }) =>
  `#${((clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).padStart(6, '0')}`;

export const rgbChannels = (value) => {
  const c = parseColor(value);
  return c ? `${c.r} ${c.g} ${c.b}` : null;
};

export const darken = (value, amount = 0.14) => {
  const c = parseColor(value);
  if (!c) return null;
  const scale = (v) => v * (1 - amount);
  return toHex({ r: scale(c.r), g: scale(c.g), b: scale(c.b) });
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

// Inicialização imediata sem esperar onMounted para evitar FOUC
if (typeof window !== 'undefined') {
  updateTheme();
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

  function applyBranding(colorCandidate) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const parsed = parseColor(colorCandidate);
    const brand = parsed ? toHex(parsed) : DEFAULT_BRAND;
    const brandDark = darken(brand) || DEFAULT_BRAND;
    const channels = rgbChannels(brand) || '79 70 229';
    const darkChannels = rgbChannels(brandDark) || '67 56 202';

    root.style.setProperty('--color-brand', brand);
    root.style.setProperty('--color-brand-dark', brandDark);
    root.style.setProperty('--color-brand-rgb', channels);
    root.style.setProperty('--color-brand-dark-rgb', darkChannels);
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
