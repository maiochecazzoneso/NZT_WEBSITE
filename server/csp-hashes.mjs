// @ts-check
// server/csp-hashes.mjs — hash degli script e degli stili inline per la Content Security Policy.
//
// Astro inserisce nell'HTML alcuni script inline (runtime delle isole React, lo script `nav-gate` del
// layout) e alcuni blocchi <style>. Con `script-src 'self'` verrebbero bloccati; con 'unsafe-inline' la CSP
// non proteggerebbe più da XSS. Soluzione: dopo il build si leggono le pagine generate, si calcola lo
// SHA-256 di ogni blocco inline e solo quegli hash entrano nella CSP. Gli hash sono ricalcolati a ogni
// build, quindi non c'è nulla da mantenere a mano quando cambia uno script.
// Riferimento: docs/architettura_sicurezza_nzt_solutions.md §2.2
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Nome del file scritto accanto al bundle server e letto da server/index.mjs all'avvio. */
export const CSP_HASHES_FILE = 'csp-hashes.json';

const SCRIPT_BLOCK = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const HAS_SRC = /\ssrc\s*=/i;
const TYPE_ATTRIBUTE = /\stype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
/** Tipi MIME che il browser esegue come JavaScript (gli altri, es. application/ld+json, sono dati). */
const EXECUTABLE_TYPES = new Set([
  '',
  'module',
  'text/javascript',
  'application/javascript',
  'text/ecmascript',
  'application/ecmascript',
]);

/** @param {string} content */
const sha256 = (content) =>
  `sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}`;

/**
 * Estrae gli hash dei blocchi inline da un documento HTML.
 * @param {string} html
 * @returns {{ scripts: string[], styles: string[] }}
 */
export function extractInlineHashes(html) {
  /** @type {Set<string>} */
  const scripts = new Set();
  /** @type {Set<string>} */
  const styles = new Set();

  for (const [, attributes = '', content = ''] of html.matchAll(SCRIPT_BLOCK)) {
    if (HAS_SRC.test(attributes) || content.length === 0) continue;
    const typeMatch = TYPE_ATTRIBUTE.exec(attributes);
    const type = (typeMatch?.[1] ?? typeMatch?.[2] ?? typeMatch?.[3] ?? '').trim().toLowerCase();
    if (EXECUTABLE_TYPES.has(type)) scripts.add(sha256(content));
  }
  for (const [, content = ''] of html.matchAll(STYLE_BLOCK)) {
    if (content.length > 0) styles.add(sha256(content));
  }
  return { scripts: [...scripts].sort(), styles: [...styles].sort() };
}

/**
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function listHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listHtmlFiles(fullPath);
      return entry.isFile() && entry.name.endsWith('.html') ? [fullPath] : [];
    }),
  );
  return nested.flat();
}

/**
 * Unione degli hash di tutte le pagine HTML generate in una cartella.
 * @param {string} clientDirectory
 * @returns {Promise<{ scripts: string[], styles: string[], pages: number }>}
 */
export async function collectCspHashes(clientDirectory) {
  const files = await listHtmlFiles(clientDirectory);
  /** @type {Set<string>} */
  const scripts = new Set();
  /** @type {Set<string>} */
  const styles = new Set();
  for (const file of files) {
    const hashes = extractInlineHashes(await readFile(file, 'utf8'));
    hashes.scripts.forEach((hash) => scripts.add(hash));
    hashes.styles.forEach((hash) => styles.add(hash));
  }
  return { scripts: [...scripts].sort(), styles: [...styles].sort(), pages: files.length };
}

const HASH_PATTERN = /^sha256-[A-Za-z0-9+/]{43}=$/;

/**
 * Legge e valida il file degli hash. Qualsiasi anomalia è un errore: senza hash le isole React non si
 * avvierebbero, e un valore manomesso finirebbe dentro un header di sicurezza.
 * @param {string} filePath
 * @returns {Promise<{ scripts: string[], styles: string[] }>}
 */
export async function readCspHashes(filePath) {
  const parsed = /** @type {unknown} */ (JSON.parse(await readFile(filePath, 'utf8')));
  if (typeof parsed !== 'object' || parsed === null)
    throw new Error(`${filePath}: formato non valido`);
  const { scripts, styles } = /** @type {Record<string, unknown>} */ (parsed);
  for (const list of [scripts, styles]) {
    if (
      !Array.isArray(list) ||
      !list.every((hash) => typeof hash === 'string' && HASH_PATTERN.test(hash))
    ) {
      throw new Error(`${filePath}: elenco di hash non valido`);
    }
  }
  return { scripts: /** @type {string[]} */ (scripts), styles: /** @type {string[]} */ (styles) };
}

/**
 * Integrazione Astro: a fine build scrive `dist/server/csp-hashes.json`.
 * @returns {import('astro').AstroIntegration}
 */
export function cspHashesIntegration() {
  /** @type {URL | undefined} */
  let clientDir;
  /** @type {URL | undefined} */
  let serverDir;
  return {
    name: 'nzt-csp-hashes',
    hooks: {
      'astro:config:done': ({ config }) => {
        clientDir = config.build.client;
        serverDir = config.build.server;
      },
      'astro:build:done': async ({ logger }) => {
        if (!clientDir || !serverDir)
          throw new Error('[nzt-csp-hashes] cartelle di build non risolte');
        const { pages, ...hashes } = await collectCspHashes(fileURLToPath(clientDir));
        if (pages === 0) throw new Error('[nzt-csp-hashes] nessuna pagina HTML trovata nel build');
        const target = path.join(fileURLToPath(serverDir), CSP_HASHES_FILE);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, `${JSON.stringify(hashes, null, 2)}\n`, 'utf8');
        logger.info(
          `${pages} pagine analizzate: ${hashes.scripts.length} script e ${hashes.styles.length} stili inline ammessi dalla CSP`,
        );
      },
    },
  };
}
