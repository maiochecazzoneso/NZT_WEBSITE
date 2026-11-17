// @ts-check
// server/index.mjs — punto di ingresso di produzione (Railway: `node server/index.mjs`).
// Avvolge il server standalone di Astro con il perimetro di sicurezza di create-server.mjs.
// Avviare direttamente `dist/server/entry.mjs` salta questi controlli: non va fatto in produzione.
// Riferimento: docs/architettura_sicurezza_nzt_solutions.md §1.2
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { createSecureServer } from './create-server.mjs';
import { CSP_HASHES_FILE, readCspHashes } from './csp-hashes.mjs';
import { log } from './logger.mjs';

// L'entry di Astro avvierebbe da solo un proprio server HTTP: qui serve solo il suo handler
process.env.ASTRO_NODE_AUTOSTART = 'disabled';

const SHUTDOWN_GRACE_MS = 10_000;

async function main() {
  const config = loadConfig();
  const cspHashes = await readCspHashes(
    fileURLToPath(new URL(`../dist/server/${CSP_HASHES_FILE}`, import.meta.url)),
  );
  const entryUrl = new URL('../dist/server/entry.mjs', import.meta.url).href;
  const { handler } = /** @type {{ handler: import('./create-server.mjs').NodeHandler }} */ (
    await import(entryUrl)
  );

  const server = createSecureServer({ handler, config, cspHashes, log });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => resolve(undefined));
  });

  log('info', 'server_started', {
    host: config.host,
    port: config.port,
    originVerification: config.originVerifySecret !== null,
    railwayProxy: config.trustRailwayProxy,
    cspInlineScripts: cspHashes.scripts.length,
    cspInlineStyles: cspHashes.styles.length,
  });
  if (config.production && config.originVerifySecret === null) {
    log('warn', 'origin_verification_disabled', {
      detail:
        'ORIGIN_VERIFY_SECRET non impostato: il servizio accetta anche richieste che non passano da Cloudflare',
    });
  }

  let shuttingDown = false;
  /** @param {NodeJS.Signals} signal */
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'server_stopping', { signal });
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

process.on('uncaughtException', (error) => {
  log('error', 'uncaught_exception', { error });
  process.exit(1);
});

main().catch((error) => {
  log('error', 'server_start_failed', { error });
  process.exit(1);
});
