// DPoP (RFC 9449) lato client: coppia di chiavi ECDSA P-256 con chiave privata NON estraibile,
// thumbprint JWK (RFC 7638) e costruzione delle prove `dpop+jwt` firmate ES256.

import { base64UrlEncode, base64UrlEncodeJson, utf8 } from '../lib/base64url';

export interface EcPublicJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

export interface DpopKey {
  /** Chiave privata non estraibile: JS (anche XSS) può usarla per firmare ma non leggerla. */
  readonly privateKey: CryptoKey;
  readonly publicKey: CryptoKey;
  /** JWK pubblica (solo kty/crv/x/y) inserita nell'header di ogni prova. */
  readonly jwk: EcPublicJwk;
  /** RFC 7638 SHA-256 thumbprint (= cnf.jkt dell'access token). */
  readonly jkt: string;
}

const EC_PARAMS: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_PARAMS: EcdsaParams = { name: 'ECDSA', hash: 'SHA-256' };

/** Membri obbligatori per il thumbprint, per tipo di chiave (RFC 7638 §3.2, RFC 8037 §2). */
const THUMBPRINT_MEMBERS: Record<string, readonly string[]> = {
  EC: ['crv', 'kty', 'x', 'y'],
  RSA: ['e', 'kty', 'n'],
  OKP: ['crv', 'kty', 'x'],
};

export async function generateDpopKeyPair(): Promise<CryptoKeyPair> {
  // extractable=false si applica alla chiave privata; la pubblica resta sempre esportabile.
  return crypto.subtle.generateKey(EC_PARAMS, false, ['sign', 'verify']);
}

export async function jwkThumbprint(jwk: Record<string, unknown>): Promise<string> {
  const kty = jwk.kty;
  const members = typeof kty === 'string' ? THUMBPRINT_MEMBERS[kty] : undefined;
  if (!members) throw new Error('Unsupported JWK key type');
  const canonical: Record<string, string> = {};
  for (const name of members) {
    const value = jwk[name];
    if (typeof value !== 'string' || value.length === 0) throw new Error('Incomplete JWK');
    canonical[name] = value; // inserimento in ordine lessicografico => JSON canonico RFC 7638
  }
  const digest = await crypto.subtle.digest('SHA-256', utf8(JSON.stringify(canonical)));
  return base64UrlEncode(digest);
}

export async function toDpopKey(pair: CryptoKeyPair): Promise<DpopKey> {
  if (pair.privateKey.extractable) {
    throw new Error('DPoP private key must be non-extractable');
  }
  const exported = await crypto.subtle.exportKey('jwk', pair.publicKey);
  if (exported.kty !== 'EC' || exported.crv !== 'P-256' || !exported.x || !exported.y) {
    throw new Error('DPoP public key must be EC P-256');
  }
  const jwk: EcPublicJwk = { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y };
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    jwk,
    jkt: await jwkThumbprint({ ...jwk }),
  };
}

/** `htu` = URI della richiesta senza query né fragment (RFC 9449 §4.2). */
export function normalizeHtu(url: string): string {
  const parsed = new URL(url);
  parsed.search = '';
  parsed.hash = '';
  return parsed.href;
}

/** `ath` = base64url(SHA-256(ASCII(access token))) (RFC 9449 §4.2). */
export async function accessTokenHash(accessToken: string): Promise<string> {
  return base64UrlEncode(await crypto.subtle.digest('SHA-256', utf8(accessToken)));
}

export interface DpopProofOptions {
  method: string;
  url: string;
  /** Presente solo sulle richieste a risorse protette: aggiunge il claim `ath`. */
  accessToken?: string;
  now?: () => number;
  jti?: () => string;
}

export interface DpopProofClaims {
  jti: string;
  htm: string;
  htu: string;
  iat: number;
  ath?: string;
}

export async function createDpopProof(key: DpopKey, options: DpopProofOptions): Promise<string> {
  const now = options.now ?? Date.now;
  const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: key.jwk };
  const claims: DpopProofClaims = {
    jti: (options.jti ?? (() => crypto.randomUUID()))(),
    htm: options.method.toUpperCase(),
    htu: normalizeHtu(options.url),
    iat: Math.floor(now() / 1000),
  };
  if (options.accessToken !== undefined) {
    claims.ath = await accessTokenHash(options.accessToken);
  }
  const signingInput = `${base64UrlEncodeJson(header)}.${base64UrlEncodeJson(claims)}`;
  const signature = await crypto.subtle.sign(SIGN_PARAMS, key.privateKey, utf8(signingInput));
  // WebCrypto restituisce la firma ECDSA in formato IEEE P1363 (r || s, 2 x 32 byte per P-256):
  // è esattamente la codifica JWS ES256 (RFC 7518 §3.4), nessuna conversione DER necessaria.
  if (signature.byteLength !== 64) throw new Error('Unexpected ECDSA signature length');
  return `${signingInput}.${base64UrlEncode(signature)}`;
}
