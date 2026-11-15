// @ts-check
// server/security-headers.mjs — unica definizione degli header di sicurezza del sito.
// Usata dal server di produzione (server/index.mjs, per ogni risposta: pagine statiche, asset, API) e dal
// middleware Astro (src/middleware.ts, per le rotte dinamiche).
// Riferimento: docs/architettura_sicurezza_nzt_solutions.md §2.2

/** Origine di Cloudflare Turnstile: script del widget e iframe della challenge. */
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

/**
 * @typedef {object} CspHashes
 * @property {string[]} scripts Hash ('sha256-…') degli script inline presenti nell'HTML generato
 * @property {string[]} styles Hash ('sha256-…') dei blocchi <style> inline presenti nell'HTML generato
 */

/** @param {string[]} hashes */
const quoted = (hashes) => hashes.map((hash) => `'${hash}'`);

/**
 * Content Security Policy delle pagine HTML.
 * Niente 'unsafe-inline' né 'unsafe-eval' per gli script: gli script inline ammessi sono solo quelli il
 * cui hash è stato calcolato dall'HTML al momento del build (server/csp-hashes.mjs).
 *
 * @param {CspHashes} hashes
 * @param {{ upgradeInsecureRequests?: boolean }} [options]
 * @returns {string}
 */
export function buildPageCsp(hashes, { upgradeInsecureRequests = true } = {}) {
  const directives = [
    "default-src 'self'",
    ["script-src 'self'", ...quoted(hashes.scripts), TURNSTILE_ORIGIN].join(' '),
    // Fallback per i browser che non conoscono style-src-elem / style-src-attr
    "style-src 'self' 'unsafe-inline'",
    // Blocchi <style>: solo file del sito e blocchi inline con hash noto
    ["style-src-elem 'self'", ...quoted(hashes.styles)].join(' '),
    // Attributi style="…": li usano React (SSR delle isole), GSAP e Three.js
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    `frame-src ${TURNSTILE_ORIGIN}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (upgradeInsecureRequests) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

/** CSP delle risposte non HTML (API JSON, errori testuali): non devono poter caricare né eseguire nulla. */
export const API_CSP =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/**
 * Header difensivi indipendenti dal contenuto: anti-sniffing, anti-clickjacking, HSTS, isolamento.
 * @type {Readonly<Record<string, string>>}
 */
export const BASE_SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), midi=(), display-capture=(), browsing-topics=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Permitted-Cross-Domain-Policies': 'none',
});

/**
 * Insieme completo degli header per le risposte del sito.
 * @param {CspHashes} hashes
 * @param {{ upgradeInsecureRequests?: boolean }} [options]
 * @returns {Record<string, string>}
 */
export function pageSecurityHeaders(hashes, options) {
  return { ...BASE_SECURITY_HEADERS, 'Content-Security-Policy': buildPageCsp(hashes, options) };
}

/**
 * Header per le risposte delle API: CSP chiusa, nessun riuso cross-origin, mai in cache.
 * @returns {Record<string, string>}
 */
export function apiSecurityHeaders() {
  return {
    ...BASE_SECURITY_HEADERS,
    'Content-Security-Policy': API_CSP,
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  };
}
