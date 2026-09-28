/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Cor da marca da empresa (whitelabel), escrita pelo ThemeContext.
        // Em canais RGB + <alpha-value>: so assim o Tailwind gera as variacoes
        // com opacidade (bg-brand/10, shadow-brand/30...). Com var() puro essas
        // classes simplesmente nao existiam no CSS final.
        brand: {
          DEFAULT: 'rgb(var(--color-brand-rgb, 79 70 229) / <alpha-value>)',
          dark: 'rgb(var(--color-brand-dark-rgb, 67 56 202) / <alpha-value>)',
        }
      },
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        }
      },
      animation: {
        shimmer: 'shimmer 1.5s infinite',
      }
    },
  },
  plugins: [],
}
