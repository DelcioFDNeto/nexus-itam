// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt': o PWAToast pergunta antes de trocar de versao. Com
      // 'autoUpdate' o service worker assumia no meio da sessao e as rotas
      // lazy ainda nao abertas apontavam para chunks que ja nao existiam.
      registerType: 'prompt',
      // Quem registra e o PWAToast (virtual:pwa-register); o script inline
      // registrava o mesmo service worker uma segunda vez.
      injectRegister: false,
      includeAssets: ['logo.webp', 'logo.png', 'pwa-192x192.png', 'pwa-512x512.png', 'carbon-fibre.png', 'vite.svg'],
      workbox: {
        // Bibliotecas pesadas usadas sob demanda (leitura de PDF, Excel,
        // exportacao em PDF) ficam fora do precache obrigatorio: so quem usa
        // baixa, e o cache de runtime guarda depois.
        globIgnores: ['**/pdf.worker*', '**/pdf-*.js', '**/xlsx-*.js', '**/jspdf*.js', '**/html2canvas*.js'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/assets\/(pdf|xlsx|jspdf|html2canvas)[^/]*\.m?js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'nexus-on-demand-libs',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      manifest: {
        name: 'Nexus ITAM',
        short_name: 'ITAM',
        description: 'Gestão de Ativos Nexus ITAM',
        theme_color: '#020617',
        background_color: '#020617',
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