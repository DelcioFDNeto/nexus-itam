// src/contexts/ThemeContext.jsx
import React, { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext();

export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider = ({ children }) => {
  // Theme: 'light', 'dark', ou 'system'
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('nexus_theme') || 'system';
  });

  // Accent Color (Cor principal)
  // Cores: 'blue' (padrão), 'green', 'purple', 'orange', 'cyan'
  const [accentColor, setAccentColor] = useState(() => {
    return localStorage.getItem('nexus_accent') || 'blue';
  });

  useEffect(() => {
    const root = window.document.documentElement;
    
    // Aplica Dark/Light mode
    root.classList.remove('light', 'dark');
    
    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }

    localStorage.setItem('nexus_theme', theme);

  }, [theme]);

  useEffect(() => {
    const root = window.document.documentElement;
    
    // Mapa de cores (brand e brand-dark)
    const colorMap = {
      blue: { brand: '#4F46E5', dark: '#4338CA' }, // Indigo Tailwind
      green: { brand: '#10B981', dark: '#059669' }, // Emerald Tailwind
      purple: { brand: '#8B5CF6', dark: '#7C3AED' }, // Violet Tailwind
      orange: { brand: '#F97316', dark: '#EA580C' }, // Orange Tailwind
      cyan: { brand: '#06B6D4', dark: '#0891B2' }, // Cyan Tailwind
    };

    const selectedColor = colorMap[accentColor] || colorMap.blue;

    root.style.setProperty('--color-brand', selectedColor.brand);
    root.style.setProperty('--color-brand-dark', selectedColor.dark);

    localStorage.setItem('nexus_accent', accentColor);
  }, [accentColor]);

  const value = {
    theme,
    setTheme,
    accentColor,
    setAccentColor
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};
