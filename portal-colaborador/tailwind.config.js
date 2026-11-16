/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"IBM Plex Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        brand: {
          DEFAULT: 'rgb(var(--color-brand-rgb, 12 92 171) / <alpha-value>)',
          dark: 'rgb(var(--color-brand-dark-rgb, 10 74 138) / <alpha-value>)',
          fg: 'rgb(var(--color-brand-fg-rgb, 250 250 250) / <alpha-value>)',
          ring: 'rgb(var(--color-brand-ring-rgb, 12 92 171) / <alpha-value>)',
          'text-light': 'var(--color-brand-text-light, #0C5CAB)',
          'text-dark': 'var(--color-brand-text-dark, #60a5fa)',
        },
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        zoomIn95: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-0.5rem)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out both',
        'zoom-in': 'zoomIn95 0.2s ease-out both',
        'slide-down': 'slideDown 0.25s ease-out both',
      },
    },
  },
  plugins: [],
};
