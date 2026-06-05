// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'inline',
      includeAssets: ['logo.webp', 'logo.png', 'pwa-192x192.png', 'pwa-512x512.png', 'carbon-fibre.png', 'vite.svg'],
      manifest: {
        name: 'Nexus ITAM',
        short_name: 'ITAM',
        description: 'Gestão de Ativos Nexus ITAM',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
  build: {
    // Otimização de performance: separar dependências pesadas em chunks independentes
    rollupOptions: {
      output: {
        manualChunks: {
          // Firebase SDK (~206 KB) — carregado sob demanda quando AuthContext precisa
          'vendor-firebase': [
            'firebase/app',
            'firebase/auth',
            'firebase/firestore',
          ],
          // React core (~140 KB) — necessário sempre, mas separado para cache de longo prazo
          'vendor-react': [
            'react',
            'react-dom',
            'react-router-dom',
          ],
          // Bibliotecas de UI (~60 KB) — framer-motion, sonner, etc.
          'vendor-ui': [
            'framer-motion',
            'sonner',
          ],
        },
      },
    },
    // Aumentar limite de aviso para não poluir o console (chunks grandes são intencionais)
    chunkSizeWarningLimit: 600,
  },
  server: {
    host: true,
    port: 5173,
  }
})