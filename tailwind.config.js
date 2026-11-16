/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"IBM Plex Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // Cor da marca da empresa (whitelabel), escrita pelo ThemeContext.
        // Em canais RGB + <alpha-value>: so assim o Tailwind gera as variacoes
        // com opacidade (bg-brand/10, shadow-brand/30...). Com var() puro essas
        // classes simplesmente nao existiam no CSS final.
        brand: {
          DEFAULT: 'rgb(var(--color-brand-rgb, 12 92 171) / <alpha-value>)',
          dark: 'rgb(var(--color-brand-dark-rgb, 10 74 138) / <alpha-value>)',
          fg: 'rgb(var(--color-brand-fg-rgb, 250 250 250) / <alpha-value>)',
          'text-light': 'var(--color-brand-text-light, #0C5CAB)',
          'text-dark': 'var(--color-brand-text-dark, #60a5fa)',
        },
        surface: {
          canvas: '#f8fafc',
          card: '#ffffff',
          'dark-canvas': '#09090b',
          'dark-card': '#111113',
          'dark-elevated': '#18181b',
        },
        enterprise: {
          primary: '#0C5CAB',
          'primary-dark': '#0A4A8A',
          ink: '#09090b',
          'ink-muted': '#52525b',
          surface: '#111113',
          canvas: '#09090b',
        },
      },
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        zoomIn95: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        slideTop2: {
          '0%': { opacity: '0', transform: 'translateY(-0.5rem)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.5s infinite',
        'fade-in': 'fadeIn 0.2s ease-out forwards',
        'zoom-in': 'zoomIn95 0.18s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'slide-down': 'slideTop2 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
    },
  },
  plugins: [],
}
