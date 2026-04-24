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
          DEFAULT: '#4F46E5', // Indigo-600
          dark: '#4338CA',    // Indigo-700
        }
      }
    },
  },
  plugins: [],
}