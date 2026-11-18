// @ts-check
// server/client-ip.mjs — indirizzo IP del client, scelto solo da fonti che il client non può falsificare.
// Gli header di inoltro sono testo libero: chi parla direttamente con il server può scriverci ciò che
// vuole (e aggirare così il rate limit). Ogni header viene quindi creduto solo se è stato scritto da un
// proxy di cui abbiamo verificato la presenza.
// Riferimento: docs/architettura_sicurezza_nzt_solutions.md §1.2
import { isIP } from 'node:net';

/**
 * @param {string | string[] | undefined} value
 * @returns {string | null}
 */
function asIp(value) {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  return isIP(candidate) ? candidate : null;
}

/**
 * @param {object} input
 * @param {import('node:http').IncomingHttpHeaders} input.headers
 * @param {string | undefined} input.socketAddress
 * @param {boolean} input.originVerified La richiesta ha presentato il segreto condiviso con Cloudflare
 * @param {boolean} input.trustRailwayProxy Il processo gira dietro l'edge di Railway
 * @returns {string}
 */
export function resolveClientIp({ headers, socketAddress, originVerified, trustRailwayProxy }) {
  // 1. Passata da Cloudflare (verificato dal segreto): CF-Connecting-IP è sempre riscritto da Cloudflare
  if (originVerified) {
    const fromCloudflare = asIp(headers['cf-connecting-ip']);
    if (fromCloudflare) return fromCloudflare;
  }
  // 2. Dietro l'edge di Railway: X-Real-IP è impostato dal proxy di Railway con l'IP del peer
  if (trustRailwayProxy) {
    const fromRailway = asIp(headers['x-real-ip']);
    if (fromRailway) return fromRailway;
  }
  // 3. Nessun proxy fidato: vale solo l'indirizzo della connessione TCP
  return normalizeIp(asIp(socketAddress) ?? 'unknown');
}

/**
 * IPv4 mappato su IPv6 (::ffff:203.0.113.7) → IPv4 puro, così la stessa sorgente ha una sola chiave.
 * @param {string} ip
 */
export function normalizeIp(ip) {
  return ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
}

/**
 * Chiave del rate limit: un IPv4 intero, oppure il prefisso /64 di un IPv6 (un singolo cliente dispone
 * di un intero /64: limitare per indirizzo consentirebbe di ruotarlo all'infinito).
 * @param {string} ip
 */
export function rateLimitKey(ip) {
  const normalized = normalizeIp(ip);
  if (isIP(normalized) !== 6) return normalized;
  return `${expandIpv6(normalized).slice(0, 4).join(':')}::/64`;
}

/**
 * Indirizzo troncato per i log (minimizzazione dei dati personali): /24 per IPv4, /48 per IPv6.
 * @param {string} ip
 */
export function anonymizeIp(ip) {
  const normalized = normalizeIp(ip);
  const version = isIP(normalized);
  if (version === 4) return `${normalized.split('.').slice(0, 3).join('.')}.0/24`;
  if (version === 6) return `${expandIpv6(normalized).slice(0, 3).join(':')}::/48`;
  return 'unknown';
}

/**
 * Espande un IPv6 valido nei suoi 8 gruppi esadecimali (senza zeri iniziali).
 * @param {string} ip
 * @returns {string[]}
 */
function expandIpv6(ip) {
  let address = ip.split('%')[0] ?? ip; // rimuove l'eventuale zone id
  // Coda IPv4 (es. 64:ff9b::192.0.2.1) → due gruppi esadecimali
  const lastColon = address.lastIndexOf(':');
  const tail = address.slice(lastColon + 1);
  if (tail.includes('.')) {
    const [a = 0, b = 0, c = 0, d = 0] = tail.split('.').map(Number);
    address = `${address.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', rest] = address.split('::');
  const headGroups = head ? head.split(':') : [];
  const restGroups = rest ? rest.split(':') : [];
  const missing = rest === undefined ? 0 : 8 - headGroups.length - restGroups.length;
  return [...headGroups, ...Array(Math.max(missing, 0)).fill('0'), ...restGroups].map((group) =>
    (Number.parseInt(group, 16) || 0).toString(16),
  );
}
