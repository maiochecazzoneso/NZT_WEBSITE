import { describe, expect, it, vi } from 'vitest';
import { sendEmail } from '@/lib/email';

const email = {
  from: 'NZT Solutions <sito@nztsolutions.it>',
  to: 'info@nztsolutions.it',
  replyTo: 'mario@example.com',
  subject: 'Richiesta dal sito',
  text: '<b>non interpretato</b>',
};

describe('sendEmail (Resend)', () => {
  it('invia solo testo semplice all’endpoint ufficiale, con la chiave nell’header Authorization', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{"id":"1"}', { status: 200 }));
    expect(await sendEmail('re_key', email, fetchImpl)).toEqual({ ok: true });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('error');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer re_key');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      from: email.from,
      to: [email.to],
      reply_to: email.replyTo,
      subject: email.subject,
      text: email.text,
    });
    expect(body).not.toHaveProperty('html');
  });

  it('degli errori conserva solo stato e nome, non il messaggio (può citare i dati inviati)', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ name: 'validation_error', message: 'Invalid `to`: mario@example.com' }),
          { status: 422 },
        ),
    );
    const result = await sendEmail('re_key', email, fetchImpl);
    expect(result).toEqual({ ok: false, status: 422, reason: 'validation_error' });
    expect(JSON.stringify(result)).not.toContain('mario@example.com');
  });

  it('gestisce risposte non JSON ed errori di rete senza eccezioni', async () => {
    const html = vi.fn<typeof fetch>(async () => new Response('<html>502</html>', { status: 502 }));
    expect(await sendEmail('re_key', email, html)).toEqual({
      ok: false,
      status: 502,
      reason: 'unknown',
    });
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await sendEmail('re_key', email, offline)).toEqual({
      ok: false,
      status: null,
      reason: 'TypeError',
    });
  });
});
