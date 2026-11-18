// Access token SOLO in memoria (spec §6.1): variabile nella closure del modulo, mai in
// localStorage/sessionStorage/cookie/URL, mai loggato. Persa al reload: la sessione si ripristina
// con il refresh token (cookie HttpOnly) + la chiave DPoP persistita.

export interface TokenStore {
  set(accessToken: string, expiresInSeconds: number): void;
  /** Token se ancora valido (con margine `skewSeconds`), altrimenti null. */
  get(skewSeconds?: number): string | null;
  /** Epoch ms di scadenza, o null. */
  expiresAt(): number | null;
  clear(): void;
}

export function createTokenStore(now: () => number = Date.now): TokenStore {
  let token: string | null = null;
  let expiry = 0;
  return {
    set(accessToken, expiresInSeconds) {
      if (!accessToken || !Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
        throw new Error('Invalid token response');
      }
      token = accessToken;
      expiry = now() + expiresInSeconds * 1000;
    },
    get(skewSeconds = 5) {
      if (token === null) return null;
      if (now() >= expiry - skewSeconds * 1000) return null;
      return token;
    },
    expiresAt() {
      return token === null ? null : expiry;
    },
    clear() {
      token = null;
      expiry = 0;
    },
  };
}
