import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'virtual-pwa-register-mock',
      resolveId(id) {
        if (id === 'virtual:pwa-register/react') {
          return '\0virtual:pwa-register/react';
        }
      },
      load(id) {
        if (id === '\0virtual:pwa-register/react') {
          return 'export const useRegisterSW = () => ({ needRefresh: [false, () => {}], offlineReady: [false, () => {}], updateServiceWorker: async () => {} });';
        }
      },
    },
  ],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: './src/setupTests.js',
    // Regras do Firestore exigem o emulador (`npm run test:rules`) e os
    // microsservicos Node possuem suite propria (`npm run test:services`).
    exclude: [...configDefaults.exclude, 'tests/rules/**', 'services/**', 'portal-colaborador/**'],
  },
})
