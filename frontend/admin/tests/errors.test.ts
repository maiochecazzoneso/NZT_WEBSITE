import { describe, expect, it } from 'vitest';
import { DETAIL, describeError, formatWait, isUnauthorized } from '../src/api/errors';
import { ApiError, parseRetryAfter } from '../src/api/http';

const http = (status: number, detail: string | null = null, retry: number | null = null) =>
  new ApiError('http', status, detail, retry);

describe('describeError', () => {
  it('login 401: generic message, never the backend detail', () => {
    const message = describeError(http(401, DETAIL.invalidCredentials), 'login');
    expect(message).toBe('Credenziali non valide.');
    expect(message).not.toContain('Invalid');
  });

  it('login 429 shows the wait from Retry-After', () => {
    expect(describeError(http(429, 'Too many requests', 30), 'login')).toBe(
      'Troppe richieste in poco tempo. Riprova tra 30 secondi.',
    );
  });

  it('401 outside login means expired session', () => {
    expect(describeError(http(401, 'Invalid access token'), 'load')).toMatch(/sessione è scaduta/);
    expect(isUnauthorized(http(401))).toBe(true);
    expect(isUnauthorized(http(403))).toBe(false);
    expect(isUnauthorized(new ApiError('network'))).toBe(false);
  });

  it('401 with an invalid DPoP proof points at the device clock', () => {
    expect(describeError(http(401, DETAIL.invalidDpop), 'load')).toMatch(/data e ora/);
  });

  it('403: admin permission message', () => {
    expect(describeError(http(403, 'Admin role required'), 'action')).toMatch(
      /permessi di amministratore/,
    );
  });

  it('429 with and without Retry-After', () => {
    expect(describeError(http(429, 'Too many requests', 42), 'action')).toBe(
      'Troppe richieste in poco tempo. Riprova tra 42 secondi.',
    );
    expect(describeError(http(429, 'Too many requests', 3600), 'action')).toBe(
      'Troppe richieste in poco tempo. Riprova tra 60 minuti.',
    );
    expect(describeError(http(429, 'Too many requests', null), 'action')).toBe(
      'Troppe richieste in poco tempo. Attendi qualche minuto e riprova.',
    );
  });

  it('409 shows the backend detail (admin-facing), without a doubled full stop', () => {
    expect(describeError(http(409, 'Campaign is not a draft.'), 'action')).toBe(
      'Operazione non consentita: Campaign is not a draft.',
    );
    expect(describeError(http(409, null), 'action')).toBe(
      'Operazione non consentita in questo momento.',
    );
  });

  it('other detail strings are never leaked', () => {
    const message = describeError(http(422, 'body.code: String should match pattern'), 'action');
    expect(message).toMatch(/non sono validi/);
    expect(message).not.toContain('pattern');
    expect(describeError(http(500, 'Internal'), 'load')).toMatch(/temporaneamente non disponibile/);
    expect(describeError(http(503, 'busy', 5), 'load')).toMatch(/Riprova tra 5 secondi/);
  });

  it('transport errors and unknown errors', () => {
    expect(describeError(new ApiError('network'), 'load')).toMatch(/Impossibile contattare/);
    expect(describeError(new ApiError('timeout'), 'load')).toMatch(/non ha risposto/);
    expect(describeError(new ApiError('invalid-response', 200), 'load')).toMatch(/non valida/);
    expect(describeError(new Error('boom'), 'load')).toMatch(/errore imprevisto/);
  });

  it('formatWait / parseRetryAfter', () => {
    expect(formatWait(1)).toBe('1 secondo');
    expect(formatWait(61)).toBe('2 minuti');
    expect(parseRetryAfter('30')).toBe(30);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('garbage')).toBeNull();
  });
});
