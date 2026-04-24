// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'Nexus ITAM',
        short_name: 'ITAM',
        description: 'Gestão de Ativos Nexus ITAM',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone', // Remove a barra de navegação do navegador
        orientation: 'portrait', // Força modo retrato no celular (opcional)
        icons: [
          {
            src: 'pwa-192x192.png', // Lembre-se que você precisará criar essas imagens na pasta public depois
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
  server: {
    host: true, // <--- O PULO DO GATO: Libera o acesso para outros dispositivos na rede
    port: 5173, // Garante que a porta seja sempre a 5173
  }
})