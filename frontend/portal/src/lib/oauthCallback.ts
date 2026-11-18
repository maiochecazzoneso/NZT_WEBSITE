// Parametri del redirect OAuth (code/state) letti UNA sola volta dall'URL e subito rimossi con
// history.replaceState: non restano nella cronologia, nei bookmark né in referrer successivi.

export const GOOGLE_CALLBACK_PATH = '/auth/google/callback';

export type OAuthCallbackResult =
  | { type: 'code'; code: string; state: string }
  | { type: 'error'; error: string }
  | { type: 'missing' };

const MAX_CODE_LENGTH = 2048;
const MAX_STATE_LENGTH = 256;

export function parseOAuthCallback(search: string): OAuthCallbackResult {
  const params = new URLSearchParams(search);
  const error = params.get('error');
  if (error !== null) return { type: 'error', error: error.slice(0, 64) };
  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state || code.length > MAX_CODE_LENGTH || state.length > MAX_STATE_LENGTH) {
    return { type: 'missing' };
  }
  return { type: 'code', code, state };
}

export interface CallbackLocation {
  pathname: string;
  search: string;
  hash: string;
}

export interface CallbackHistory {
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

/** Restituisce una funzione che legge e ripulisce l'URL alla prima chiamata e poi ripete il risultato. */
export function createOAuthCallbackConsumer(): (
  location: CallbackLocation,
  history: CallbackHistory,
) => OAuthCallbackResult {
  let consumed: OAuthCallbackResult | null = null;
  return (location, history) => {
    if (consumed) return consumed;
    consumed = parseOAuthCallback(location.search);
    if (location.search || location.hash) history.replaceState(null, '', location.pathname);
    return consumed;
  };
}
