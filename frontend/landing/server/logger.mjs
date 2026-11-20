// @ts-check
// server/logger.mjs — log strutturati (una riga JSON per evento) con mascheramento delle credenziali.
// Regole: nessun dato del modulo contatti (nome, email, messaggio) finisce nei log; qualsiasi campo il
// cui nome richiama una credenziale viene sostituito prima della scrittura; gli IP sono troncati.
// Riferimento: docs/architettura_sicurezza_nzt_solutions.md §8

const SENSITIVE_KEY =
  /pass(word|wd)?|secret|token|authorization|cookie|api[-_]?key|credit[-_]?card|card[-_]?number|cvv|origin[-_]?verify/i;
const REDACTED = '[REDACTED]';
const MAX_STRING_LENGTH = 512;
const MAX_DEPTH = 4;

/**
 * Copia un valore sostituendo i campi sensibili. I caratteri di controllo vengono resi innocui da
 * JSON.stringify (nessuna riga di log falsificabile); le stringhe troppo lunghe vengono troncate.
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {unknown}
 */
export function redact(value, depth = 0) {
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';
  if (value instanceof Error)
    return { name: value.name, message: redact(value.message, depth + 1) };
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  /** @type {Record<string, unknown>} */
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(item, depth + 1);
  }
  return output;
}

/**
 * @typedef {'info' | 'warn' | 'error'} LogLevel
 * @typedef {(level: LogLevel, event: string, fields?: Record<string, unknown>) => void} LogFunction
 */

/**
 * @param {(line: string, level: LogLevel) => void} [write] Destinazione delle righe (default: stdout/stderr)
 * @returns {LogFunction}
 */
export function createLogger(write = defaultWrite) {
  return (level, event, fields = {}) => {
    const record = {
      time: new Date().toISOString(),
      level,
      event,
      .../** @type {Record<string, unknown>} */ (redact(fields)),
    };
    write(JSON.stringify(record), level);
  };
}

/**
 * @param {string} line
 * @param {LogLevel} level
 */
function defaultWrite(line, level) {
  (level === 'info' ? process.stdout : process.stderr).write(`${line}\n`);
}

/** Logger condiviso da server e rotte API. */
export const log = createLogger();
