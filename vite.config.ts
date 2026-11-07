import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Addresses allowed to open the dev / preview server: Cloudflare quick tunnels (*.trycloudflare.com)
  // and any domains listed in VITE_ALLOWED_HOSTS (comma separated), e.g. pos.yourcafe.com
  const allowedHosts = ['.trycloudflare.com', ...(env.VITE_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean)];
  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': '/src',
        // Same rules as the API (copies of pos-backend files, see src/shared) so online and offline prices are identical.
        '@shared/promotions': fileURLToPath(new URL('./src/shared/promotions.ts', import.meta.url)),
        '@shared/coupons': fileURLToPath(new URL('./src/shared/coupons.ts', import.meta.url)),
        '@shared/cash': fileURLToPath(new URL('./src/shared/cash.ts', import.meta.url)),
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
      allowedHosts,
      // In development, /api calls go to the NestJS API, so there are no CORS issues.
      proxy: { '/api': env.VITE_API_PROXY || 'http://localhost:3000', '/docs': env.VITE_API_PROXY || 'http://localhost:3000' },
    },
    preview: {
      port: 4173,
      allowedHosts,
      proxy: { '/api': env.VITE_API_PROXY || 'http://localhost:3000', '/docs': env.VITE_API_PROXY || 'http://localhost:3000' },
    },
  };
});
