// src/contexts/ThemeContext.jsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { safeCssColor } from '../utils/sanitize';
import { darken, rgbChannels } from '../utils/color';
import { useAuth } from './AuthContext';

const ThemeContext = createContext();

// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = () => useContext(ThemeContext);

const THEME_KEY = 'nexus_theme';
const ACCENT_KEY = 'nexus_accent';

const DEFAULT_BRAND = '#4F46E5';

// Acentos pessoais oferecidos na tela de configuracoes.
// eslint-disable-next-line react-refresh/only-export-components
export const ACCENTS = {
  blue: '#4F46E5',
  green: '#10B981',
  purple: '#8B5CF6',
  orange: '#F97316',
  cyan: '#06B6D4',
};

const readStorage = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    // Modo privado ou armazenamento bloqueado: segue com o padrao.
    return null;
  }
};

const writeStorage = (key, value) => {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* apenas nao persiste */
  }
};

const prefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

export const ThemeProvider = ({ children }) => {
  // 'light' | 'dark' | 'system'
  const [theme, setThemeState] = useState(() => readStorage(THEME_KEY) || 'system');

  // Acento pessoal. `null` = "automatico": herda a cor da empresa (whitelabel).
  const [accentColor, setAccentState] = useState(() => {
    const stored = readStorage(ACCENT_KEY);
    return stored && stored in ACCENTS ? stored : null;
  });

  // Cor da marca do inquilino (whitelabel). Fonte unica: o perfil resolvido
  // pelo AuthContext. O ThemeContext e o unico lugar que escreve --color-brand.
  const auth = useAuth();
  const tenantBrand = auth?.currentUser?.primaryColor || null;

  // Tema efetivo depois de resolver 'system'. E este valor, e nao `theme`,
  // que a UI deve consultar para saber se esta escuro.
  const [resolvedTheme, setResolvedTheme] = useState(() =>
    (readStorage(THEME_KEY) || 'system') === 'system'
      ? (prefersDark() ? 'dark' : 'light')
      : readStorage(THEME_KEY),
  );

  const setTheme = useCallback((next) => {
    setThemeState(next);
    writeStorage(THEME_KEY, next);
  }, []);

  const setAccentColor = useCallback((next) => {
    const valid = next && next in ACCENTS ? next : null;
    setAccentState(valid);
    writeStorage(ACCENT_KEY, valid);
  }, []);

  // --- Claro / escuro -------------------------------------------------------
  useEffect(() => {
    const root = document.documentElement;

    const apply = () => {
      const effective = theme === 'system' ? (prefersDark() ? 'dark' : 'light') : theme;
      root.classList.toggle('dark', effective === 'dark');
      root.classList.toggle('light', effective !== 'dark');
      // Faz os controles nativos (scrollbar da pagina, <select>, seletor de
      // data) seguirem o tema do app. Sem isto eles continuam claros quando o
      // usuario escolhe escuro mas o sistema operacional esta claro.
      root.style.colorScheme = effective;
      setResolvedTheme(effective);
    };

    apply();

    // Em 'system' o tema precisa acompanhar o SO em tempo real. Antes, trocar
    // o tema do sistema so surtia efeito depois de recarregar a pagina.
    if (theme !== 'system') return undefined;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  // --- Cor de destaque ------------------------------------------------------
  useEffect(() => {
    const root = document.documentElement;

    // Precedencia: escolha pessoal > marca da empresa > padrao Nexus.
    // Antes, ThemeContext e AuthContext gravavam --color-brand de forma
    // independente e o ultimo a rodar vencia, de forma imprevisivel.
    const candidate = accentColor
      ? ACCENTS[accentColor]
      : safeCssColor(tenantBrand) || DEFAULT_BRAND;
    // Cor que passa no sanitizador mas nao e interpretavel cai no padrao.
    const brand = rgbChannels(candidate) ? candidate : DEFAULT_BRAND;
    const brandDark = darken(brand);

    root.style.setProperty('--color-brand', brand);
    root.style.setProperty('--color-brand-dark', brandDark);
    // Canais consumidos pelo Tailwind (bg-brand, bg-brand/10, shadow-brand/30...).
    root.style.setProperty('--color-brand-rgb', rgbChannels(brand));
    root.style.setProperty('--color-brand-dark-rgb', rgbChannels(brandDark));
  }, [accentColor, tenantBrand]);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      resolvedTheme,
      isDark: resolvedTheme === 'dark',
      accentColor,
      setAccentColor,
      tenantBrand,
    }),
    [theme, setTheme, resolvedTheme, accentColor, setAccentColor, tenantBrand],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};
