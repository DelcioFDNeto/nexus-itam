import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: './src/setupTests.js',
    // Regras do Firestore exigem o emulador: `npm run test:rules`.
    exclude: [...configDefaults.exclude, 'tests/rules/**'],
  },
})
