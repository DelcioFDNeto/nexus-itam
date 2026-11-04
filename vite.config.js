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
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // Impede que o Service Worker PWA intercepte endpoints do API Gateway
        // (/api, /ws, /docs, /openapi.json, /health) quando hospedado sob o mesmo
        // domínio/Nginx na VPS.
        navigateFallbackDenylist: [
          /^\/api\//,
          /^\/ws\//,
          /^\/docs/,
          /^\/openapi\.json/,
          /^\/health/,
        ],
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
        id: '/',
        start_url: '/',
        scope: '/',
        name: 'Nexus ITAM',
        short_name: 'Nexus ITAM',
        description: 'Plataforma Corporativa de Gestão de Ativos e Operações de TI — Nexus ITAM',
        theme_color: '#020617',
        background_color: '#020617',
        display: 'standalone',
        // 'portrait' travava o PWA instalado em tablets e desktops.
        orientation: 'any',
        display_override: ['standalone', 'minimal-ui'],
        categories: ['business', 'productivity'],
        prefer_related_applications: false,
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          {
            name: 'Novo Ativo',
            short_name: 'Novo Ativo',
            description: 'Cadastrar novo ativo patrimonial',
            url: '/assets/new',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
          {
            name: 'Auditoria QR',
            short_name: 'Auditoria',
            description: 'Auditoria rápida de ativos via QR Code',
            url: '/audit',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
          {
            name: 'Tarefas',
            short_name: 'Tarefas',
            description: 'Acompanhar ordens de serviço e tarefas',
            url: '/tasks',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
          {
            name: 'Service Desk',
            short_name: 'Service Desk',
            description: 'Central de suporte e chamados de TI',
            url: '/service-desk',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
        ],
      },
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
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/docs': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/openapi.json': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8000',
        ws: true,
      },
    },
  }
})
