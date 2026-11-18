// Backend finto per i test: verifica DAVVERO le prove DPoP con node:crypto (implementazione
// indipendente da src/auth/dpop.ts), applica RTR + reuse detection come il backend reale (D-A8)
// e simula il cookie jar del browser (inviato solo con credentials: 'include').

import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';

export const API = 'https://api.nztsolutions.it';

interface Family {
  jkt: string;
  revoked: boolean;
}
interface RefreshRecord {
  family: number;
  used: boolean;
}

export interface FakeApiOptions {
  /** Ritardo artificiale del server (ms) per aprire finestre di concorrenza. */
  latencyMs?: number;
  users?: Record<string, string>;
  /** false = l'utente non è (più) admin: le risorse rispondono 403. */
  entitled?: boolean;
}

function b64urlJson(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
}

export function thumbprintNode(jwk: Record<string, unknown>): string {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return createHash('sha256').update(canonical).digest('base64url');
}

export class FakeApi {
  jar: string | null = null;
  readonly families: Family[] = [];
  readonly refreshTokens = new Map<string, RefreshRecord>();
  readonly accessTokens = new Map<string, { jkt: string; family: number }>();
  readonly seenJti = new Set<string>();
  readonly calls: Array<{ path: string; status: number }> = [];
  inFlightRefresh = 0;
  maxConcurrentRefresh = 0;
  reuseDetected = 0;
  proofErrors: string[] = [];
  private readonly latency: number;
  private readonly users: Record<string, string>;
  entitled: boolean;

  constructor(options: FakeApiOptions = {}) {
    this.latency = options.latencyMs ?? 5;
    this.users = options.users ?? { 'mario@example.com': 'SuperSecurePassword123!' };
    this.entitled = options.entitled ?? true;
  }

  countCalls(path: string): number {
    return this.calls.filter((call) => call.path === path).length;
  }

  /** Valida la prova DPoP; restituisce il jkt o lancia. */
  checkProof(proof: string | null, method: string, url: string, accessToken?: string): string {
    if (!proof) throw new Error('missing proof');
    const [h, p, s] = proof.split('.');
    if (!h || !p || !s) throw new Error('malformed');
    const header = b64urlJson(h);
    const claims = b64urlJson(p);
    if (header.typ !== 'dpop+jwt' || header.alg !== 'ES256') throw new Error('bad header');
    const jwk = header.jwk as Record<string, unknown>;
    if (Object.keys(jwk).sort().join() !== 'crv,kty,x,y') throw new Error('jwk members');
    const key = createPublicKey({ key: jwk as never, format: 'jwk' });
    const ok = verify(
      'sha256',
      Buffer.from(`${h}.${p}`),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(s, 'base64url'),
    );
    if (!ok) throw new Error('bad signature');
    if (claims.htm !== method) throw new Error('htm');
    const expectedHtu = new URL(url);
    expectedHtu.search = '';
    if (claims.htu !== expectedHtu.href) throw new Error('htu');
    if (typeof claims.iat !== 'number' || Math.abs(Date.now() / 1000 - claims.iat) > 60) {
      throw new Error('iat');
    }
    const jti = String(claims.jti);
    if (this.seenJti.has(jti)) throw new Error('replay');
    this.seenJti.add(jti);
    if (accessToken !== undefined) {
      const ath = createHash('sha256').update(accessToken).digest('base64url');
      if (claims.ath !== ath) throw new Error('ath');
    } else if ('ath' in claims) {
      throw new Error('unexpected ath');
    }
    return thumbprintNode(jwk);
  }

  private issue(family: number, jkt: string) {
    const refresh = randomBytes(32).toString('base64url');
    this.refreshTokens.set(refresh, { family, used: false });
    this.jar = refresh;
    const access = `at.${randomBytes(16).toString('base64url')}`;
    this.accessTokens.set(access, { jkt, family });
    return json(200, { access_token: access, token_type: 'DPoP', expires_in: 600 });
  }

  readonly fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const path = new URL(url).pathname;
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    const cookie = init.credentials === 'include' ? this.jar : null;
    const response = await this.handle(path, method, url, headers, cookie, init);
    this.calls.push({ path, status: response.status });
    return response;
  };

  private async handle(
    path: string,
    method: string,
    url: string,
    headers: Headers,
    cookie: string | null,
    init: RequestInit,
  ): Promise<Response> {
    const isAuth = path.startsWith('/api/v1/admin/auth/');
    if (isAuth && init.credentials !== 'include') return json(500, { detail: 'test: credentials' });
    if (!isAuth && init.credentials !== 'omit') return json(500, { detail: 'test: credentials' });
    if (path === '/api/v1/admin/auth/refresh') {
      this.inFlightRefresh += 1;
      this.maxConcurrentRefresh = Math.max(this.maxConcurrentRefresh, this.inFlightRefresh);
      try {
        return await this.refresh(method, url, headers, cookie);
      } finally {
        this.inFlightRefresh -= 1;
      }
    }
    await delay(this.latency);
    let jkt: string;
    const authorization = headers.get('Authorization');
    const accessToken = authorization?.startsWith('DPoP ') ? authorization.slice(5) : undefined;
    try {
      jkt = this.checkProof(headers.get('DPoP'), method, url, accessToken);
    } catch (error) {
      this.proofErrors.push((error as Error).message);
      return json(401, { detail: 'Invalid DPoP proof' });
    }
    if (path === '/api/v1/admin/auth/login') {
      const body = JSON.parse(String(init.body)) as { email: string; password: string };
      if (this.users[body.email] !== body.password) {
        return json(401, { detail: 'Invalid email or password' });
      }
      this.families.push({ jkt, revoked: false });
      return this.issue(this.families.length - 1, jkt);
    }
    if (path === '/api/v1/admin/auth/logout') {
      if (!cookie) return json(401, { detail: 'Missing refresh token' });
      const record = this.refreshTokens.get(cookie);
      if (record) {
        const family = this.families[record.family];
        if (family && family.jkt !== jkt) return json(401, { detail: 'Invalid DPoP proof' });
        if (family) family.revoked = true;
      }
      this.jar = null;
      return new Response(null, { status: 204 });
    }
    if (path === '/api/v1/admin/stats') {
      const bound = accessToken ? this.accessTokens.get(accessToken) : undefined;
      if (!bound || bound.jkt !== jkt || this.families[bound.family]?.revoked) {
        return json(401, { detail: 'Invalid access token' });
      }
      if (!this.entitled) return json(403, { detail: 'Admin role required' });
      return json(200, { users_total: 3, downloads_per_day: [] });
    }
    return json(404, { detail: 'Not Found' });
  }

  private async refresh(method: string, url: string, headers: Headers, cookie: string | null) {
    let jkt: string;
    try {
      jkt = this.checkProof(headers.get('DPoP'), method, url);
    } catch (error) {
      this.proofErrors.push((error as Error).message);
      return json(401, { detail: 'Invalid DPoP proof' });
    }
    if (!cookie) return json(401, { detail: 'Missing refresh token' });
    const record = this.refreshTokens.get(cookie);
    if (!record) return json(401, { detail: 'Invalid refresh token' });
    const family = this.families[record.family];
    if (!family || family.revoked) return json(401, { detail: 'Invalid refresh token' });
    if (family.jkt !== jkt) {
      return json(401, { detail: 'DPoP key does not match refresh token binding' });
    }
    if (record.used) {
      this.reuseDetected += 1;
      for (const f of this.families) f.revoked = true;
      this.jar = null;
      return json(401, { detail: 'Refresh token reuse detected' });
    }
    record.used = true; // consumo atomico PRIMA della latenza: una seconda richiesta concorrente = riuso
    await delay(this.latency);
    return this.issue(record.family, jkt);
  }
}

export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
