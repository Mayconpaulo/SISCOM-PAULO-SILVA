import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const APP_BUILD_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    define: {
      __SISCOM_BUILD_ID__: JSON.stringify(APP_BUILD_ID),
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
          'assets/brasao_exercito.png',
          'assets/brasao_1bimec.png',
          'assets/logo_arma_comunicacoes.png',
          'assets/cartoes/marca_dagua.png',
          'assets/cartoes/brasao_republica.png',
          'assets/cartoes/distintivo_1bimec.png',
          'assets/cartoes/distintivo_feb.png',
          'assets/cartoes/brasao_exercito_fita.png',
          'assets/cartoes/assinatura_cmt.png',
        ],
        manifest: {
          id: '/',
          name: 'SISCOM',
          short_name: 'SISCOM',
          description: 'Sistema auxiliar institucional para geração, edição e armazenamento de documentos e cartões.',
          theme_color: '#101413',
          background_color: '#0B0E0D',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          lang: 'pt-BR',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          cacheId: `siscom-${APP_BUILD_ID}`,
          cleanupOutdatedCaches: true,
          skipWaiting: true,
          clientsClaim: true,
          importScripts: ['/sw-cache-helper.js'],
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          globPatterns: ['**/*.{ico,png,svg,woff,woff2}'],
          globIgnores: ['**/aistudio/**'],
          navigateFallback: null,
          runtimeCaching: [
            {
              urlPattern: ({ url }) =>
                url.pathname.startsWith('/api/') ||
                url.pathname === '/version.json' ||
                url.pathname.startsWith('/src/') ||
                url.pathname.startsWith('/@') ||
                url.pathname.startsWith('/node_modules/'),
              handler: 'NetworkOnly',
            },
            {
              urlPattern: ({ request }) => request.mode === 'navigate',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'siscom-ephemeral-pages',
                networkTimeoutSeconds: 10,
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'classic',
        },
      }),
      // Injects build ID meta into HTML, copies src/assets into dist/, and writes dist/version.json
      // so all devices detect new builds immediately without relying on browser cache expiry.
      {
        name: 'siscom-version-and-assets',
        transformIndexHtml(html: string): string {
          return html.replace(
            '</head>',
            `    <meta name="siscom-build-id" content="${APP_BUILD_ID}" />\n  </head>`
          );
        },
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(import.meta.dirname, 'dist');
          const srcAssets = path.resolve(import.meta.dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir)) {
            fs.writeFileSync(
              path.join(distDir, 'version.json'),
              JSON.stringify(
                { version: APP_BUILD_ID, builtAt: new Date().toISOString() },
                null,
                2
              ),
              'utf-8'
            );
            if (fs.existsSync(srcAssets)) {
              fs.cpSync(srcAssets, distAssets, { recursive: true, force: true });
            }
          }
        },
      },
    ],
    build: {
      sourcemap: false,
      minify: 'esbuild',
      chunkSizeWarningLimit: 1000,
    },
    esbuild: mode === 'production' ? { drop: ['debugger'], legalComments: 'none' } : undefined,
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
