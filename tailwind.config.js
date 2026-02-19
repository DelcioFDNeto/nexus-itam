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
          DEFAULT: '#DC2626', // Um vermelho vibrante (red-600 do tailwind)
          dark: '#B91C1C',    // Um tom mais escuro para hover (red-700)
        }
      }
    },
  },
  plugins: [],
}