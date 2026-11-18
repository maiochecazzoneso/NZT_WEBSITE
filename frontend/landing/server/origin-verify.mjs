// @ts-check
// server/origin-verify.mjs — Origin IP Cloaking: accetta solo le richieste arrivate tramite Cloudflare.
// Cloudflare aggiunge a ogni richiesta verso l'origine l'header segreto X-Origin-Verify (Transform Rule);
// chi contatta direttamente il dominio *.up.railway.app non lo conosce e riceve 403.
// Riferimento: docs/architettura_sicurezza_nzt_solutions.md §1.2
import { createHash, timingSafeEqual } from 'node:crypto';

export const ORIGIN_VERIFY_HEADER = 'x-origin-verify';

/** @param {Buffer | string} value */
const digest = (value) => createHash('sha256').update(value).digest();

/**
 * Confronto a tempo costante. Si confrontano i digest SHA-256, così anche la lunghezza del valore
 * presentato non trapela dal tempo di risposta.
 *
 * @param {string | string[] | undefined} presented Valore dell'header nella richiesta
 * @param {Buffer} secret Segreto atteso (già normalizzato in minuscolo)
 * @returns {boolean}
 */
export function isOriginVerified(presented, secret) {
  if (typeof presented !== 'string' || presented.length === 0 || presented.length > 256) {
    return false;
  }
  return timingSafeEqual(digest(presented.trim().toLowerCase()), digest(secret));
}
