// Verifica email (AGGIUNTA rispetto alla specifica). Il link ricevuto per email è
// `/verifica-email#token=<token>`: il token viaggia nel FRAMMENTO dell'URL, quindi non arriva mai
// nei log del server né in un header Referer. Viene letto UNA sola volta, l'URL viene subito
// ripulito con history.replaceState e il token è inviato solo con una POST esplicita.

import type { ApiFetcher } from '../api/http';
import { ApiError } from '../api/http';

export const VERIFY_EMAIL_PATH = '/verifica-email';
export const VERIFY_EMAIL_API = '/api/v1/auth/verify-email';
export const RESEND_VERIFICATION_API = '/api/v1/auth/resend-verification';
export const ME_API = '/api/v1/auth/me';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export type VerificationLinkResult = { type: 'token'; token: string } | { type: 'missing' };

export function parseVerificationFragment(hash: string): VerificationLinkResult {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  const token = new URLSearchParams(fragment).get('token');
  return token !== null && TOKEN_RE.test(token) ? { type: 'token', token } : { type: 'missing' };
}

export interface LinkLocation {
  pathname: string;
  search: string;
  hash: string;
}

export interface LinkHistory {
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

/** Legge e ripulisce l'URL alla prima chiamata; le chiamate successive ripetono il risultato. */
export function createVerificationLinkConsumer(): (
  location: LinkLocation,
  history: LinkHistory,
) => VerificationLinkResult {
  let consumed: VerificationLinkResult | null = null;
  return (location, history) => {
    if (consumed) return consumed;
    consumed = parseVerificationFragment(location.hash);
    if (location.search || location.hash) history.replaceState(null, '', location.pathname);
    return consumed;
  };
}

/** POST esplicita (mai una GET che consuma il token): nessun cookie, nessuna prova DPoP. */
export async function submitVerificationToken(fetcher: ApiFetcher, token: string): Promise<void> {
  await fetcher({ method: 'POST', path: VERIFY_EMAIL_API, body: { token } });
}

export interface AccountInfo {
  email: string;
  isVerified: boolean;
}

export function parseAccountInfo(data: unknown): AccountInfo {
  if (
    typeof data !== 'object' ||
    data === null ||
    typeof (data as { email?: unknown }).email !== 'string' ||
    typeof (data as { is_verified?: unknown }).is_verified !== 'boolean'
  ) {
    throw new ApiError('invalid-response', 200);
  }
  const { email, is_verified } = data as { email: string; is_verified: boolean };
  return { email: email.slice(0, 255), isVerified: is_verified };
}
