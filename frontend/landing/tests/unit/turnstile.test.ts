import { describe, expect, it, vi } from 'vitest';
import { verifyTurnstile } from '@/lib/turnstile';

const respond = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

describe('verifyTurnstile', () => {
  it('chiama solo l’endpoint ufficiale di Cloudflare, in POST, senza seguire redirect', async () => {
    const fetchImpl = respond({ success: true, action: 'contact', hostname: 'nztsolutions.it' });
    const result = await verifyTurnstile('token', 'secret', { remoteIp: '203.0.113.9', fetchImpl });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('error');
    const body = init?.body as URLSearchParams;
    expect(Object.fromEntries(body)).toEqual({
      secret: 'secret',
      response: 'token',
      remoteip: '203.0.113.9',
    });
  });

  it('rifiuta un token non valido riportando i codici di errore', async () => {
    const fetchImpl = respond({ success: false, 'error-codes': ['invalid-input-response'] });
    expect(await verifyTurnstile('token', 'secret', { fetchImpl })).toEqual({
      ok: false,
      reason: 'invalid-input-response',
    });
  });

  it('rifiuta un token emesso per un’altra azione', async () => {
    const fetchImpl = respond({ success: true, action: 'login' });
    expect(await verifyTurnstile('token', 'secret', { fetchImpl })).toEqual({
      ok: false,
      reason: 'action mismatch',
    });
  });

  it('con hostname ammessi rifiuta token emessi altrove o senza hostname', async () => {
    const allowedHostnames = ['nztsolutions.it', 'www.nztsolutions.it'];
    const ok = respond({ success: true, hostname: 'WWW.nztsolutions.it' });
    expect(await verifyTurnstile('t', 's', { allowedHostnames, fetchImpl: ok })).toEqual({
      ok: true,
    });

    for (const body of [{ success: true, hostname: 'evil.example' }, { success: true }]) {
      const result = await verifyTurnstile('t', 's', {
        allowedHostnames,
        fetchImpl: respond(body),
      });
      expect(result).toEqual({ ok: false, reason: 'hostname mismatch' });
    }
  });

  it('fallisce in modo chiuso su risposta malformata, errore HTTP o errore di rete', async () => {
    expect((await verifyTurnstile('t', 's', { fetchImpl: respond({ success: 'true' }) })).ok).toBe(
      false,
    );
    expect((await verifyTurnstile('t', 's', { fetchImpl: respond('<html>', 200) })).ok).toBe(false);
    expect(await verifyTurnstile('t', 's', { fetchImpl: respond({}, 500) })).toEqual({
      ok: false,
      reason: 'siteverify HTTP 500',
    });
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await verifyTurnstile('t', 's', { fetchImpl: offline })).toEqual({
      ok: false,
      reason: 'TypeError',
    });
  });
});
