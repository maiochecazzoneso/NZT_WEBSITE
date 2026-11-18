import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';
import { PRODUCTION_API_ORIGIN, securityHeaders } from './csp.config';

// Nessun @vitejs/plugin-react: JSX compilato da esbuild (runtime automatico). Così in sviluppo non
// viene iniettato il preambolo inline di React Fast Refresh e lo script-src resta 'self' anche in dev.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, 'VITE_');
  const apiBaseUrl = env.VITE_API_BASE_URL || PRODUCTION_API_ORIGIN;
  return {
    plugins: [tailwindcss()],
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
