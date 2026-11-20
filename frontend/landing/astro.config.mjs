import { defineConfig, envField } from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { MAX_BODY_BYTES } from './server/config.mjs';
import { cspHashesIntegration } from './server/csp-hashes.mjs';

export default defineConfig({
  site: 'https://nztsolutions.it',
  // Le pagine restano statiche (prerender). Solo le rotte con `prerender = false` (es. /api/contact)
  // girano sul server Node, che su Railway serve anche i file statici.
  output: 'static',
  // Astro 7 ha cambiato il default in 'jsx' (rimuove spazi tra elementi inline): manteniamo la resa precedente
  compressHTML: true,
  // In produzione il server non si avvia da `dist/server/entry.mjs` ma da `server/index.mjs`, che avvolge
  // l'handler di Astro con il perimetro di sicurezza (docs/architettura_sicurezza_nzt_solutions.md §1.2).
  // bodySizeLimit è la seconda barriera: il limite effettivo (MAX_BODY_BYTES) lo applicano perimetro e rotta.
  adapter: node({ mode: 'standalone', bodySizeLimit: 4 * MAX_BODY_BYTES }),
  security: {
    // Rifiuta i POST/PUT/PATCH/DELETE con `Origin` diverso dall'host (anti-CSRF a livello di framework)
    checkOrigin: true,
    allowedDomains: [
      { hostname: 'nztsolutions.it', protocol: 'https' },
      { hostname: 'www.nztsolutions.it', protocol: 'https' },
    ],
  },
  integrations: [
    react(),
    // A fine build calcola gli hash degli script/stili inline per la Content Security Policy
    cspHashesIntegration(),
    sitemap({
      changefreq: 'weekly',
      priority: 1.0,
      lastmod: new Date(),
      filter: (page) => !page.includes('/api/') && !page.includes('/404'),
    }),
  ],
  env: {
    schema: {
      // Cloudflare Turnstile: chiave pubblica (incorporata nel bundle al build) e segreta (solo server)
      PUBLIC_TURNSTILE_SITE_KEY: envField.string({
        context: 'client',
        access: 'public',
        optional: true,
      }),
      TURNSTILE_SECRET_KEY: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      // Hostname (separati da virgola) su cui il token Turnstile deve essere stato emesso
      TURNSTILE_ALLOWED_HOSTNAMES: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      // Resend: invio email del modulo contatti
      RESEND_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      CONTACT_TO_EMAIL: envField.string({
        context: 'server',
        access: 'secret',
        default: 'info@nztsolutions.it',
      }),
      CONTACT_FROM_EMAIL: envField.string({
        context: 'server',
        access: 'secret',
        default: 'NZT Solutions <sito@nztsolutions.it>',
      }),
    },
  },
  vite: {
    plugins: [tailwindcss()],
    // Il bundle server include tutte le dipendenze: in produzione bastano `dist/` e `server/`, senza
    // node_modules nell'immagine (docs/architettura_sicurezza_nzt_solutions.md §6).
    ssr: { noExternal: true },
    build: {
      cssMinify: 'lightningcss',
    },
  },
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },
});
