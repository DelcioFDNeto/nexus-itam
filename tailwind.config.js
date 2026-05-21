/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // ADICIONE ISSO AQUI:
      colors: {
        brand: {
          DEFAULT: 'var(--color-brand, #4F46E5)',
          dark: 'var(--color-brand-dark, #4338CA)',
        }
      }
    },
  },
  plugins: [],
}