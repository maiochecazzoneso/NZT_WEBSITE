import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { PRODUCTION_API_ORIGIN, renderPagesHeaders, securityHeaders } from './csp.config';

// Su Cloudflare Pages / Workers Builds (CF_PAGES=1 o WORKERS_CI=1 durante la build) emette dist/_headers con la CSP coerente con
// VITE_API_BASE_URL. Nel container Caddy gli header li imposta il Caddyfile: nessun file emesso.
function pagesHeaders(apiBaseUrl: string): Plugin {
  return {
    name: 'nzt-pages-headers',
    apply: 'build',
    generateBundle() {
      if (!process.env.CF_PAGES && !process.env.WORKERS_CI && !process.env.NZT_EMIT_PAGES_HEADERS)
        return;
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: renderPagesHeaders(apiBaseUrl),
      });
    },
  };
}

// Nessun @vitejs/plugin-react: JSX compilato da esbuild (runtime automatico). Così in sviluppo non
// viene iniettato il preambolo inline di React Fast Refresh e lo script-src resta 'self' anche in dev.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, 'VITE_');
  const apiBaseUrl = env.VITE_API_BASE_URL || PRODUCTION_API_ORIGIN;
  return {
    plugins: [tailwindcss(), pagesHeaders(apiBaseUrl)],
    esbuild: { jsx: 'automatic' },
    build: {
      target: 'es2022',
      sourcemap: false,
      // Nessun polyfill modulepreload: niente fetch() verso 'self' (connect-src = solo API).
      modulePreload: { polyfill: false },
    },
    server: { headers: securityHeaders(apiBaseUrl, { dev: true }) },
    preview: { headers: securityHeaders(apiBaseUrl) },
  };
});
