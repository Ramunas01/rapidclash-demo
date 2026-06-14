import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Dev proxy: keep the PWA same-origin so api.ts / ws.ts work with their
  // same-origin defaults. The REST paths and the /ws upgrade are forwarded to
  // the server on :3000 (override target via the standard Vite env if needed).
  server: {
    proxy: {
      '/auth': 'http://localhost:3000',
      '/wallet': 'http://localhost:3000',
      '/games': 'http://localhost:3000',
      '/leaderboard': 'http://localhost:3000',
      '/matches': 'http://localhost:3000',
      '/admin': 'http://localhost:3000',
      '/ws': { target: 'http://localhost:3000', ws: true },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.svg'],
      manifest: {
        name: 'RapidClash',
        short_name: 'RapidClash',
        description: 'Human-vs-human gaming platform',
        display: 'standalone',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        icons: [
          { src: '/icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: '/icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        runtimeCaching: [
          {
            urlPattern: /^\/(auth|wallet|games|leaderboard|matches)(\/|$)/,
            handler: 'NetworkFirst',
            options: { cacheName: 'api-cache', networkTimeoutSeconds: 10 },
          },
        ],
      },
    }),
  ],
});
