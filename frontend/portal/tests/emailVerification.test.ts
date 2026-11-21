import { describe, expect, it, vi } from 'vitest';
import { describeError } from '../src/api/errors';
import { ApiError, apiFetch } from '../src/api/http';
import {
  VERIFY_EMAIL_API,
  createVerificationLinkConsumer,
  parseAccountInfo,
  parseVerificationFragment,
  submitVerificationToken,
} from '../src/lib/emailVerification';
import { API } from './helpers/fakeApi';

// Token fittizio di 43 caratteri base64url (con '_' e '-'), costruito: nessuna stringa che sembri un segreto.
const TOKEN = `${'a'.repeat(20)}_-${'B'.repeat(21)}`;

describe('verification link (token in the URL fragment)', () => {
  it('reads the token once and strips the fragment with history.replaceState', () => {
    expect(TOKEN).toHaveLength(43);
    const consume = createVerificationLinkConsumer();
    const history = { replaceState: vi.fn() };
    const location = { pathname: '/verifica-email', search: '', hash: `#token=${TOKEN}` };
    expect(consume(location, history)).toEqual({ type: 'token', token: TOKEN });
    expect(history.replaceState).toHaveBeenCalledTimes(1);
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/verifica-email');
    // Doppio effetto StrictMode: stesso risultato, URL non riletto né riscritto.
    expect(consume({ ...location, hash: '' }, history)).toEqual({ type: 'token', token: TOKEN });
    expect(history.replaceState).toHaveBeenCalledTimes(1);
  });

  it('ignores a token in the query string and malformed tokens', () => {
    expect(parseVerificationFragment('')).toEqual({ type: 'missing' });
    expect(parseVerificationFragment('#token=short')).toEqual({ type: 'missing' });
    expect(parseVerificationFragment(`#token=${TOKEN}x`)).toEqual({ type: 'missing' });
    expect(parseVerificationFragment(`#token=${TOKEN.slice(0, 42)}%2F`)).toEqual({
      type: 'missing',
    });
    const consume = createVerificationLinkConsumer();
    const history = { replaceState: vi.fn() };
    const result = consume(
      { pathname: '/verifica-email', search: `?token=${TOKEN}`, hash: '' },
      history,
    );
    expect(result).toEqual({ type: 'missing' });
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/verifica-email');
  });

  it('submits the token with an explicit cookie-less POST, never in the URL', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(null, { status: 204 });
    });
    await submitVerificationToken(apiFetch, TOKEN);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(`${API}${VERIFY_EMAIL_API}`);
    expect(seen[0]!.url).not.toContain(TOKEN);
    expect(seen[0]!.init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      body: JSON.stringify({ token: TOKEN }),
    });
    expect((seen[0]!.init.headers as Record<string, string>).DPoP).toBeUndefined();
  });

  it('failures map to one generic message (never the backend detail)', () => {
    for (const status of [400, 422]) {
      const message = describeError(
        new ApiError('http', status, 'Invalid or expired verification token'),
        'verify-email',
      );
      expect(message).toMatch(/non è valido o è scaduto/);
      expect(message).not.toContain('Invalid');
    }
    expect(describeError(new ApiError('http', 429, null, 30), 'verify-email')).toBe(
      'Troppi tentativi in poco tempo. Riprova tra 30 secondi.',
    );
  });
});

describe('account info and resend', () => {
  it('parses /me strictly', () => {
    expect(parseAccountInfo({ email: 'a@b.it', is_verified: false })).toEqual({
      email: 'a@b.it',
      isVerified: false,
    });
    expect(() => parseAccountInfo({ email: 'a@b.it', is_verified: 'no' })).toThrow(ApiError);
    expect(() => parseAccountInfo(null)).toThrow(ApiError);
  });

  it('resend 429 shows the wait, other errors stay generic', () => {
    expect(describeError(new ApiError('http', 429, null, 3600), 'resend-verification')).toBe(
      "Hai già richiesto più volte l'email di verifica. Riprova tra 60 minuti.",
    );
    expect(describeError(new ApiError('http', 429, null, null), 'resend-verification')).toMatch(
      /Attendi qualche minuto/,
    );
    expect(
      describeError(new ApiError('http', 503, 'Email delivery failed'), 'resend-verification'),
    ).toBe('Servizio temporaneamente non disponibile. Riprova più tardi.');
  });

  it('Google callback no longer has an "unverified local account" message', () => {
    const message = describeError(new ApiError('http', 403, 'anything'), 'google-callback');
    expect(message).toBe('Accesso con Google non consentito per questo account.');
  });
});
