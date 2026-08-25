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
        theme_color: '#0a0a0c',
        background_color: '#0a0a0c',
        display: 'standalone',
        // 'portrait' travava o PWA instalado em tablets e desktops.
        orientation: 'any',
        display_override: ['standalone', 'minimal-ui'],
        categories: ['business', 'productivity'],
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
          // Notificacoes (framer-motion foi removido: nao havia nenhum import).
          'vendor-ui': ['sonner'],
          // Chart.js so entra no bundle de quem abre um dashboard com graficos.
          'vendor-charts': ['chart.js', 'react-chartjs-2'],
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