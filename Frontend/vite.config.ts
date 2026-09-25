import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import {defineConfig} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => {
  const buildId = new Date().toISOString();
  return {
    define: {
      __CAREER_EDGE_BUILD_ID__: JSON.stringify(buildId),
    },
    plugins: [
      react(), 
      tailwindcss(),
      {
        name: 'career-edge-build-version',
        transformIndexHtml: () => [{
          tag: 'meta',
          attrs: { name: 'career-edge-build', content: buildId },
          injectTo: 'head',
        }],
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'version.json',
            source: JSON.stringify({ buildId }),
          });
        },
      },
      VitePWA({
        registerType: 'autoUpdate',
        devOptions: {
          // Prevent stale development bundles from being served after code changes.
          enabled: false
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,json,wasm,task}'],
          // Version checks must reach the deployment, not the old app-shell cache.
          globIgnores: ['**/offline-webllm-*.js', '**/version.json'],
          maximumFileSizeToCacheInBytes: 5000000000, // Large max size for model weights if cached in service worker (though IndexedDB is better)
        },
        manifest: {
          name: 'Career-Edge-AI (Offline)',
          short_name: 'Career Edge',
          description: '100% Offline AI Interview Simulation',
          theme_color: '#071225',
          icons: [
            {
              src: 'vite.svg',
              sizes: '192x192',
              type: 'image/svg+xml'
            }
          ]
        }
      })
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('@mlc-ai/web-llm')) return 'offline-webllm';
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
