// Configurazione di build (variabili VITE_*, nessun segreto: finiscono nel bundle pubblico).

const DEFAULT_API_BASE_URL = 'https://api.nztsolutions.it';

function parseOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !isLoopbackHttp(url)) {
    throw new Error('Configured origin must use https');
  }
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new Error('Configured origin must not contain a path, query or fragment');
  }
  return url.origin;
}

/** http è ammesso solo verso localhost (sviluppo / test end-to-end). */
export function isLoopbackHttp(url: URL): boolean {
  return (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
  );
}

/**
 * Origin dell'API. DEVE coincidere con NZT_API_PUBLIC_BASE_URL del backend: il claim DPoP `htu`
 * è calcolato come API_BASE_URL + path e il server lo confronta con la propria base configurata.
 */
export const API_BASE_URL = parseOrigin(import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL);

/** Rinnovo anticipato dell'access token: secondi prima della scadenza. */
export const REFRESH_LEEWAY_SECONDS = 60;

/** Timeout di ogni richiesta verso l'API. */
export const REQUEST_TIMEOUT_MS = 15_000;
