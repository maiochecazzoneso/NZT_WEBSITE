// @ts-check
// server/config.mjs — configurazione del server di produzione, letta e validata una sola volta all'avvio.
// Principio fail-fast: un valore malformato blocca l'avvio (Railway mantiene attivo il deploy precedente)
// invece di lasciare in esecuzione un server con una protezione disattivata in silenzio.
// Riferimento: docs/architettura_sicurezza_nzt_solutions.md §1.2

/** Dimensione massima del corpo di una richiesta alle API (byte). Il modulo contatti ne usa ~5 KB. */
export const MAX_BODY_BYTES = 16 * 1024;

/** Lunghezza massima dell'URL accettato (path + query). */
export const MAX_URL_LENGTH = 2048;

/** Endpoint di healthcheck di Railway: unico path esente dalla verifica dell'origine. */
export const HEALTH_PATH = '/healthz';

/** Rotte dinamiche esposte: l'unico endpoint che accetta un metodo diverso da GET/HEAD. */
export const POST_ROUTES = new Set(['/api/contact']);

/**
 * Endpoint interni del framework che questo sito non usa: restano nel bundle server di Astro ma non devono
 * essere raggiungibili (ottimizzazione immagini, server islands, actions).
 */
export const BLOCKED_PATH_PREFIXES = ['/_image', '/_server-islands', '/_actions'];

const ORIGIN_SECRET_PATTERN = /^[0-9a-f]{64}$/i;

/**
 * @typedef {object} ServerConfig
 * @property {string} host
 * @property {number} port
 * @property {boolean} production
 * @property {Buffer | null} originVerifySecret Segreto condiviso con Cloudflare (header X-Origin-Verify), se configurato
 * @property {boolean} trustRailwayProxy true se il processo gira dietro l'edge di Railway (X-Real-IP affidabile)
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {ServerConfig}
 */
export function loadConfig(env = process.env) {
  const port = env.PORT === undefined || env.PORT === '' ? 8080 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT non valida: ${JSON.stringify(env.PORT)}`);
  }

  /** @type {Buffer | null} */
  let originVerifySecret = null;
  const rawSecret = env.ORIGIN_VERIFY_SECRET?.trim();
  if (rawSecret) {
    if (!ORIGIN_SECRET_PATTERN.test(rawSecret)) {
      // Il valore non viene mai riportato nel messaggio di errore
      throw new Error('ORIGIN_VERIFY_SECRET deve essere una stringa di 64 caratteri esadecimali');
    }
    originVerifySecret = Buffer.from(rawSecret.toLowerCase(), 'utf8');
  }

  return {
    host: env.HOST?.trim() || '0.0.0.0',
    port,
    production: env.NODE_ENV === 'production',
    originVerifySecret,
    // Railway inietta queste variabili in ogni container: fuori da Railway gli header di proxy non sono affidabili
    trustRailwayProxy: Boolean(env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_PROJECT_ID),
  };
}
