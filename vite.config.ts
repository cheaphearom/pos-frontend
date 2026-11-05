import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': '/src',
        // Promotion rules are shared with the API so online and offline prices are identical.
        '@shared/promotions': fileURLToPath(new URL('../api/src/promotions/engine.ts', import.meta.url)),
        '@shared/coupons': fileURLToPath(new URL('../api/src/coupons/calc.ts', import.meta.url)),
        '@shared/cash': fileURLToPath(new URL('../api/src/sales/cash.ts', import.meta.url)),
      },
    },
    build: {
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules/primevue') || id.includes('node_modules/@primeuix')) return 'primevue';
            if (id.includes('node_modules')) return 'vendor';
          },
        },
      },
    },
    server: {
      port: 5173,
      // In development, /api calls go to the NestJS API, so there are no CORS issues.
      proxy: { '/api': env.VITE_API_PROXY || 'http://localhost:3000', '/docs': env.VITE_API_PROXY || 'http://localhost:3000' },
    },
    preview: {
      port: 4173,
      proxy: { '/api': env.VITE_API_PROXY || 'http://localhost:3000', '/docs': env.VITE_API_PROXY || 'http://localhost:3000' },
    },
  };
});
