// Copyright (c) 2026 Chea Phearom. All rights reserved.
// Proprietary and confidential: see the LICENSE file.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Writes every built file (/assets/…) and a build id into dist/sw.js, so the offline cache saves the whole app when a
 * new version installs: after an update, every screen opens offline, not only the ones already used.
 */
function swPrecache(): Plugin {
  let files: string[] = [];
  let outDir = 'dist';
  return {
    name: 'pos-sw-precache',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    generateBundle(_o, bundle) { files = Object.keys(bundle).filter((f) => f.startsWith('assets/')).map((f) => '/' + f).sort(); },
    closeBundle() {
      const p = join(outDir, 'sw.js');
      const sw = readFileSync(p, 'utf8');
      const build = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      const out = sw.replace("const BUILD = 'dev';", `const BUILD = '${build}';`).replace('const ASSETS = [];', `const ASSETS = ${JSON.stringify(files)};`);
      if (out === sw) throw new Error('sw.js: BUILD / ASSETS placeholders not found');
      writeFileSync(p, out);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Addresses allowed to open the dev / preview server: Cloudflare quick tunnels (*.trycloudflare.com)
  // and any domains listed in VITE_ALLOWED_HOSTS (comma separated), e.g. pos.yourcafe.com
  const allowedHosts = ['.trycloudflare.com', ...(env.VITE_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean)];
  return {
    plugins: [vue(), swPrecache()],
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
