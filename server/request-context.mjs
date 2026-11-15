// @ts-check
// server/request-context.mjs — dati di fiducia sulla richiesta, passati dal server di produzione alle
// rotte Astro senza usare header HTTP (che un client potrebbe falsificare).
// server/index.mjs e il bundle di Astro girano nello stesso processo ma sono due copie distinte di questo
// modulo: l'istanza di AsyncLocalStorage è quindi registrata su globalThis e condivisa tra le due.
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * @typedef {object} RequestContext
 * @property {string} requestId Identificativo della richiesta, riportato nei log e nell'header X-Request-Id
 * @property {string} clientIp IP del client risolto da fonti fidate (server/client-ip.mjs)
 * @property {boolean} originVerified La richiesta è arrivata tramite Cloudflare (segreto verificato)
 */

const STORAGE_KEY = Symbol.for('nzt.security.request-context');

const globalRegistry =
  /** @type {Record<symbol, AsyncLocalStorage<RequestContext> | undefined>} */ (
    /** @type {unknown} */ (globalThis)
  );

/** @type {AsyncLocalStorage<RequestContext>} */
export const requestContext = (globalRegistry[STORAGE_KEY] ??= new AsyncLocalStorage());

/**
 * Contesto della richiesta corrente; `undefined` se il codice non gira dietro server/index.mjs
 * (sviluppo con `astro dev`, test).
 * @returns {RequestContext | undefined}
 */
export function getRequestContext() {
  return requestContext.getStore();
}
