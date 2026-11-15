// src/middleware.ts — header di sicurezza delle risposte generate a richiesta (rotte API, eventuali
// pagine SSR). Per le pagine prerenderizzate il middleware gira solo al build e i suoi header vanno persi:
// quelle risposte, come ogni altra, ricevono gli header da server/index.mjs.
// Riferimento: docs/architettura_sicurezza_nzt_solutions.md §2.2
import { defineMiddleware } from 'astro:middleware';
import { apiSecurityHeaders, BASE_SECURITY_HEADERS } from '@server/security-headers.mjs';

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  if (context.isPrerendered) return response;

  // HTML generato a richiesta: restano la CSP delle pagine impostata dal server. Tutto il resto (JSON,
  // testo) riceve la CSP chiusa delle API e non viene mai messo in cache.
  const isHtml = response.headers.get('content-type')?.toLowerCase().includes('text/html') ?? false;
  const headers = isHtml ? BASE_SECURITY_HEADERS : apiSecurityHeaders();
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
});
