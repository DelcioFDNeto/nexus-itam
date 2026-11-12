/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'rgb(var(--color-brand-rgb, 79 70 229) / <alpha-value>)',
          dark: 'rgb(var(--color-brand-dark-rgb, 67 56 202) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};
