import { describe, expect, it, vi } from 'vitest';
import { DETAIL, describeError, formatWait } from '../src/api/errors';
import { ApiError, apiFetch, parseRetryAfter } from '../src/api/http';
import { json } from './helpers/fakeApi';

describe('describeError', () => {
  const http = (status: number, detail: string | null = null, retry: number | null = null) =>
    new ApiError('http', status, detail, retry);

  it('login: generic credentials message, never the backend detail', () => {
    const message = describeError(http(401, DETAIL.invalidCredentials), 'login');
    expect(message).toBe('Email o password non corretti.');
    expect(message).not.toContain('Invalid');
  });

  it('429 with and without a readable Retry-After', () => {
    expect(describeError(http(429, 'Too many requests', 42), 'login')).toBe(
      'Troppi tentativi in poco tempo. Riprova tra 42 secondi.',
    );
    expect(describeError(http(429, 'Too many requests', 3600), 'download')).toBe(
      'Hai raggiunto il limite di richieste di download. Riprova tra 60 minuti.',
    );
    expect(describeError(http(429, 'Too many requests', null), 'login')).toBe(
      'Troppi tentativi in poco tempo. Attendi qualche minuto e riprova.',
    );
  });

  it.each([
    [http(400, 'Registration failed'), 'register', /Registrazione non riuscita/],
    [http(422), 'register', /non rispettano i requisiti/],
    [http(403, DETAIL.unverifiedLocal), 'google-callback', /non ancora verificato/],
    [http(403, DETAIL.accountDisabled), 'google-callback', /disabilitato/],
    [
      http(409, 'Account already linked to a different Google identity'),
      'google-callback',
      /già collegato/,
    ],
    [http(400, 'Invalid OAuth state'), 'google-callback', /non è valida o è scaduta/],
    [http(400, DETAIL.googleEmailUnverified), 'google-callback', /non risulta verificata/],
    [http(503, 'Google sign-in not configured'), 'google-start', /non disponibile/],
    [
      http(403, 'User does not have active entitlement for launcher_core'),
      'download',
      /licenza attiva/,
    ],
    [http(401, DETAIL.invalidDpop), 'login', /data e ora/],
    [http(500, 'Internal server error'), 'download', /temporaneamente non disponibile/],
    [new ApiError('network'), 'login', /Impossibile contattare il server/],
    [new ApiError('timeout'), 'login', /non ha risposto in tempo/],
    [new Error('boom'), 'login', /errore imprevisto/],
  ] as const)('%o in %s', (error, context, expected) => {
    const message = describeError(error, context);
    expect(message).toMatch(expected);
    if (error instanceof ApiError && error.detail) expect(message).not.toContain(error.detail);
  });

  it('formatWait', () => {
    expect(formatWait(1)).toBe('1 secondo');
    expect(formatWait(59)).toBe('59 secondi');
    expect(formatWait(61)).toBe('2 minuti');
  });
});

describe('parseRetryAfter', () => {
  it('parses delta-seconds, HTTP-date and rejects garbage', () => {
    expect(parseRetryAfter('30')).toBe(30);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:01:00 GMT', now)).toBe(60);
  });
});

describe('apiFetch', () => {
  it('turns HTTP errors into ApiError with detail and Retry-After', async () => {
    vi.stubGlobal('fetch', async () =>
      json(429, { detail: 'Too many requests' }, { 'Retry-After': '17' }),
    );
    await expect(
      apiFetch({ method: 'POST', path: '/api/v1/auth/login', body: {} }),
    ).rejects.toMatchObject({
      kind: 'http',
      status: 429,
      detail: 'Too many requests',
      retryAfterSeconds: 17,
    });
  });

  it('422 array details are not exposed as detail', async () => {
    vi.stubGlobal('fetch', async () =>
      json(422, { detail: [{ loc: ['body'], msg: 'x', type: 'y' }] }),
    );
    await expect(
      apiFetch({ method: 'POST', path: '/api/v1/auth/register', body: {} }),
    ).rejects.toMatchObject({
      status: 422,
      detail: null,
    });
  });

  it('network failures become ApiError(network); requests are cookie-less unless asked', async () => {
    const seen: RequestInit[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      seen.push(init);
      throw new TypeError('Failed to fetch');
    });
    await expect(
      apiFetch({ method: 'GET', path: '/api/v1/downloads/launcher' }),
    ).rejects.toMatchObject({
      kind: 'network',
    });
    expect(seen[0]).toMatchObject({
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      mode: 'cors',
      keepalive: false,
    });
    await expect(
      apiFetch({ method: 'POST', path: '/api/v1/auth/refresh', withCredentials: true }),
    ).rejects.toMatchObject({ kind: 'network' });
    // Rotazione del cookie: credenziali incluse + keepalive (sopravvive a reload/chiusura pagina)
    expect(seen[1]).toMatchObject({ credentials: 'include', keepalive: true });
  });

  it('refuses non-API paths', async () => {
    await expect(apiFetch({ method: 'GET', path: 'https://evil.example/x' })).rejects.toThrow();
  });
});
