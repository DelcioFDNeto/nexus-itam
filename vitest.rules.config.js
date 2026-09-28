import { defineConfig } from 'vitest/config'

// Testes das regras do Firestore. Rodam contra o emulador, fora da suite
// principal (que nao depende de Java): `npm run test:rules`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.spec.js'],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
})
