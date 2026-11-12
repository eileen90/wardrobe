import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Wardrobe',
        short_name: 'Wardrobe',
        description: 'Everything I own, laid out.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ECECEC',
        theme_color: '#ECECEC',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,woff2,png,svg}'] },
    }),
  ],
  build: { target: 'es2020' },
  server: { host: true },
});
