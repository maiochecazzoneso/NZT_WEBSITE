// @ts-check
// server/create-server.mjs — perimetro applicativo (trust boundary) davanti all'handler di Astro.
// Ogni richiesta, comprese quelle per pagine statiche e asset, attraversa questi controlli nell'ordine:
//   1. header di sicurezza impostati subito, così valgono anche per le risposte di errore
//   2. forma della richiesta (URL, lunghezza, codifica)
//   3. healthcheck di Railway (unico path esente dal punto 4)
//   4. verifica dell'origine: solo traffico passato da Cloudflare (se ORIGIN_VERIFY_SECRET è impostato)
//   5. metodo HTTP ammesso per quel path, endpoint interni non usati, dimensione del corpo
//   6. passaggio ad Astro con un contesto di fiducia (IP del client, id richiesta)
// Riferimento: docs/architettura_sicurezza_nzt_solutions.md §1.2 e §2.2
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { anonymizeIp, resolveClientIp } from './client-ip.mjs';
import {
  BLOCKED_PATH_PREFIXES,
  HEALTH_PATH,
  MAX_BODY_BYTES,
  MAX_URL_LENGTH,
  POST_ROUTES,
} from './config.mjs';
import { isOriginVerified, ORIGIN_VERIFY_HEADER } from './origin-verify.mjs';
import { requestContext } from './request-context.mjs';
import { apiSecurityHeaders, pageSecurityHeaders } from './security-headers.mjs';

/**
 * @typedef {(req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>} NodeHandler
 * @typedef {import('./logger.mjs').LogFunction} LogFunction
 */

const READ_METHODS = new Set(['GET', 'HEAD']);

/**
 * Path normalizzato usato solo per le decisioni di sicurezza: decodificato, senza segmenti `..` o barre
 * doppie, in minuscolo (un endpoint bloccato non deve tornare raggiungibile cambiando maiuscole o codifica).
 * @param {string} rawUrl
 * @returns {string | null} null se l'URL non è decodificabile
 */
export function securityPath(rawUrl) {
  const queryIndex = rawUrl.search(/[?#]/);
  const rawPath = queryIndex >= 0 ? rawUrl.slice(0, queryIndex) : rawUrl;
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const normalized = path.posix.normalize(decoded.replace(/\\/g, '/')).toLowerCase();
  return normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

/**
 * Limita le righe di log per un evento che un attaccante può generare a volontà (es. scansioni
 * dirette dell'origine): oltre la soglia al minuto conta soltanto, poi emette un riepilogo.
 * @param {LogFunction} log
 * @param {number} maxPerMinute
 */
function createLogThrottle(log, maxPerMinute) {
  let windowStart = 0;
  let emitted = 0;
  let suppressed = 0;
  /** @type {LogFunction} */
  return (level, event, fields) => {
    const now = Date.now();
    if (now - windowStart >= 60_000) {
      if (suppressed > 0) log('warn', 'security_log_suppressed', { count: suppressed });
      windowStart = now;
      emitted = 0;
      suppressed = 0;
    }
    if (emitted < maxPerMinute) {
      emitted += 1;
      log(level, event, fields);
    } else {
      suppressed += 1;
    }
  };
}

/**
 * @param {object} options
 * @param {NodeHandler} options.handler Handler standalone di Astro (file statici + rotte dinamiche)
 * @param {import('./config.mjs').ServerConfig} options.config
 * @param {import('./security-headers.mjs').CspHashes} options.cspHashes
 * @param {LogFunction} options.log
 * @returns {http.Server}
 */
export function createSecureServer({ handler, config, cspHashes, log }) {
  const pageHeaders = pageSecurityHeaders(cspHashes, {
    // In locale (http://localhost) l'upgrade forzato a HTTPS renderebbe irraggiungibili gli asset
    upgradeInsecureRequests: config.production,
  });
  const denyHeaders = apiSecurityHeaders();
  const audit = createLogThrottle(log, 30);

  /**
   * Risposta di rifiuto: testo minimo, nessun dettaglio sul motivo oltre al codice di stato.
   * @param {http.ServerResponse} res
   * @param {number} status
   * @param {Record<string, string>} [extraHeaders]
   */
  const deny = (res, status, extraHeaders = {}) => {
    const body = http.STATUS_CODES[status] ?? 'Error';
    res.writeHead(status, {
      ...denyHeaders,
      ...extraHeaders,
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      // Dopo un rifiuto non si legge il corpo della richiesta: la connessione va chiusa
      Connection: 'close',
    });
    res.end(body);
  };

  const server = http.createServer(
    {
      // Anti-slowloris: tempo massimo per ricevere gli header e l'intera richiesta
      headersTimeout: 15_000,
      requestTimeout: 30_000,
      // Superiore all'idle timeout dei proxy a monte, per non chiudere connessioni che riuseranno
      keepAliveTimeout: 65_000,
      maxHeaderSize: 16 * 1024,
    },
    (req, res) => {
      const requestId = randomUUID();
      res.setHeader('X-Request-Id', requestId);
      for (const [name, value] of Object.entries(pageHeaders)) res.setHeader(name, value);

      const method = req.method ?? '';
      const rawUrl = req.url ?? '';

      // 2. Forma della richiesta
      if (!rawUrl.startsWith('/') || rawUrl.startsWith('//')) return deny(res, 400);
      if (rawUrl.length > MAX_URL_LENGTH) return deny(res, 414);
      const pathname = securityPath(rawUrl);
      if (pathname === null) return deny(res, 400);

      // 3. Healthcheck: Railway interroga il container direttamente, senza passare da Cloudflare
      if (pathname === HEALTH_PATH) {
        if (!READ_METHODS.has(method)) return deny(res, 405, { Allow: 'GET, HEAD' });
        res.writeHead(200, {
          ...denyHeaders,
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Length': 2,
        });
        return res.end(method === 'HEAD' ? undefined : 'ok');
      }

      // 4. Verifica dell'origine
      const originVerified =
        config.originVerifySecret !== null &&
        isOriginVerified(req.headers[ORIGIN_VERIFY_HEADER], config.originVerifySecret);
      const clientIp = resolveClientIp({
        headers: req.headers,
        socketAddress: req.socket.remoteAddress,
        originVerified,
        trustRailwayProxy: config.trustRailwayProxy,
      });
      if (config.originVerifySecret !== null && !originVerified) {
        audit('warn', 'origin_verify_failed', {
          requestId,
          ip: anonymizeIp(clientIp),
          method,
          path: pathname,
        });
        return deny(res, 403);
      }
      // Il segreto non deve proseguire verso l'applicazione né comparire nei suoi log
      delete req.headers[ORIGIN_VERIFY_HEADER];

      // 5. Metodo, endpoint interni, corpo
      const isPostRoute = POST_ROUTES.has(pathname);
      if (!READ_METHODS.has(method) && !(method === 'POST' && isPostRoute)) {
        audit('warn', 'method_not_allowed', {
          requestId,
          ip: anonymizeIp(clientIp),
          method,
          path: pathname,
        });
        return deny(res, 405, { Allow: isPostRoute ? 'POST' : 'GET, HEAD' });
      }
      if (
        BLOCKED_PATH_PREFIXES.some(
          (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
        )
      ) {
        audit('warn', 'blocked_internal_endpoint', {
          requestId,
          ip: anonymizeIp(clientIp),
          path: pathname,
        });
        return deny(res, 404);
      }
      const declaredLength = req.headers['content-length'];
      if (READ_METHODS.has(method)) {
        // Una GET non ha motivo di portare un corpo: evita request smuggling e letture inutili
        if (
          (declaredLength !== undefined && declaredLength !== '0') ||
          req.headers['transfer-encoding']
        ) {
          return deny(res, 400);
        }
      } else if (declaredLength !== undefined) {
        const length = Number(declaredLength);
        if (!Number.isInteger(length) || length < 0) return deny(res, 400);
        if (length > MAX_BODY_BYTES) {
          audit('warn', 'payload_too_large', {
            requestId,
            ip: anonymizeIp(clientIp),
            path: pathname,
            length,
          });
          return deny(res, 413);
        }
      }

      // 6. Astro, con il contesto di fiducia della richiesta
      requestContext.run({ requestId, clientIp, originVerified }, () => {
        try {
          Promise.resolve(handler(req, res)).catch((error) => fail(res, requestId, error));
        } catch (error) {
          fail(res, requestId, error);
        }
      });
    },
  );

  /**
   * @param {http.ServerResponse} res
   * @param {string} requestId
   * @param {unknown} error
   */
  function fail(res, requestId, error) {
    log('error', 'request_failed', { requestId, error });
    if (res.headersSent) res.destroy();
    else deny(res, 500);
  }

  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  return server;
}
