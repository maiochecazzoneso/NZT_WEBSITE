// Validazione lato client dei campi del catalogo prodotti (stesse regole del contratto API:
// il backend resta la fonte di verità, qui si evita solo un round-trip inutile).

import type { ProductInput } from '../api/types';

export const PRODUCT_CODE_RE = /^[a-z0-9_]{2,64}$/;
export const OBJECT_KEY_RE = /^[A-Za-z0-9._/-]+$/;
export const SHA256_RE = /^[0-9a-f]{64}$/;

export type ProductErrors = Partial<Record<keyof ProductInput, string>>;

export function validateObjectKey(value: string): string | null {
  if (!value.startsWith('binaries/')) return 'Il percorso deve iniziare con "binaries/".';
  if (!OBJECT_KEY_RE.test(value)) {
    return 'Sono ammessi solo lettere, cifre e i caratteri . _ / -';
  }
  if (value.includes('..')) return 'Il percorso non può contenere "..".';
  if (value.endsWith('/')) return 'Il percorso deve indicare un file.';
  return null;
}

export function validateProduct(input: ProductInput): ProductErrors {
  const errors: ProductErrors = {};
  if (!PRODUCT_CODE_RE.test(input.code)) {
    errors.code = 'Codice di 2-64 caratteri: minuscole, cifre e underscore.';
  }
  if (input.name.trim() === '') errors.name = 'Inserisci il nome del prodotto.';
  if (input.version.trim() === '') errors.version = 'Inserisci la versione.';
  if (input.filename.trim() === '') errors.filename = 'Inserisci il nome del file.';
  const keyError = validateObjectKey(input.object_key);
  if (keyError) errors.object_key = keyError;
  if (!SHA256_RE.test(input.sha256)) {
    errors.sha256 = 'SHA-256: esattamente 64 caratteri esadecimali minuscoli.';
  }
  return errors;
}

/** `<input type="date">` (YYYY-MM-DD) -> ISO 8601 UTC a fine giornata; vuoto -> null. */
export function dateToValidUntil(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return `${date}T23:59:59Z`;
}

/** ISO 8601 -> YYYY-MM-DD per `<input type="date">` (prima parte della stringa, in UTC). */
export function validUntilToDate(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '';
}

/** Controllo minimo di forma (la verifica vera la fa il backend). */
export function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}
