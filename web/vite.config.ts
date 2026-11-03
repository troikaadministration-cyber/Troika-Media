import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/** Preconnect to the Supabase API so the first data request skips DNS/TLS setup. */
function supabasePreconnect(url: string | undefined): Plugin {
  return {
    name: 'supabase-preconnect',
    transformIndexHtml() {
      if (!url || !url.startsWith('https://')) return [];
      return [{ tag: 'link', attrs: { rel: 'preconnect', href: new URL(url).origin, crossorigin: '' }, injectTo: 'head' }];
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), supabasePreconnect(loadEnv(mode, process.cwd(), 'VITE_').VITE_SUPABASE_URL)],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Vendor code changes rarely; keeping it in its own chunks means an app
        // deploy only invalidates the (small) app chunks in users' caches.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run)[\\/]/.test(id)) return 'vendor-react';
          if (id.includes('@supabase')) return 'vendor-supabase';
          return undefined;
        },
      },
    },
  },
}));
