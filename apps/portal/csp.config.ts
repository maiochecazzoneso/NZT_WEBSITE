// apps/portal/csp.config.ts — unica fonte della Content-Security-Policy e degli header di sicurezza
// del portale. Usata da vite.config.ts (header di `vite preview` = produzione, `vite dev` = produzione
// con le sole deroghe necessarie all'HMR) e verificata dai test contro deploy/_headers e deploy/Caddyfile.

export const PRODUCTION_API_ORIGIN = 'https://api.nztsolutions.it';

export interface CspOptions {
  /** Server di sviluppo Vite: stili iniettati via <style> (HMR), WebSocket HMR, overlay errori. */
  dev?: boolean;
}

export function toOrigin(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`API base URL must be http(s): ${url}`);
  }
  if ((parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search || parsed.hash) {
    throw new Error(`API base URL must be an origin without path/query: ${url}`);
  }
  return parsed.origin;
}

export function buildCsp(apiBaseUrl: string, { dev = false }: CspOptions = {}): string {
  const api = toOrigin(apiBaseUrl);
  const directives: Array<[string, string[]]> = [
    ['default-src', ["'none'"]],
    ['script-src', ["'self'"]],
    ['style-src', dev ? ["'self'", "'unsafe-inline'"] : ["'self'"]],
    ['img-src', ["'self'"]],
    ['font-src', ["'self'"]],
    ['connect-src', dev ? ["'self'", api, 'ws:'] : [api]],
    ['manifest-src', ["'self'"]],
    ['base-uri', ["'none'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
    ['object-src', ["'none'"]],
  ];
  if (!dev) {
    // Trusted Types (Chromium): nessun sink DOM-XSS (innerHTML, script.src da stringa…) è utilizzabile.
    directives.push(['require-trusted-types-for', ["'script'"]], ['trusted-types', ["'none'"]]);
  }
  return directives.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}

export function securityHeaders(
  apiBaseUrl: string,
  options: CspOptions = {},
): Record<string, string> {
  return {
    'Content-Security-Policy': buildCsp(apiBaseUrl, options),
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  };
}
