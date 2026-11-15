import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '@server/logger.mjs';
import { createContactHandler, type ContactDeps, type ContactEnv } from '@/lib/contact-handler';
import { createRateLimiter } from '@/lib/security/rate-limit';

const payload = {
  name: 'Mario Rossi',
  email: 'mario.rossi@example.com',
  company: 'ACME Srl',
  phone: '+39 02 1234567',
  service: 'generale',
  message: 'Testo riservato del messaggio',
  turnstileToken: 'token-valido',
};

function setup(overrides: { env?: Partial<ContactEnv>; deps?: Partial<ContactDeps> } = {}) {
  const lines: string[] = [];
  const verifyCaptcha = vi.fn<ContactDeps['verifyCaptcha']>(async () => ({ ok: true }));
  const sendEmail = vi.fn<ContactDeps['sendEmail']>(async () => ({ ok: true }));
  const handler = createContactHandler({
    env: {
      turnstileSecret: 'turnstile-secret',
      turnstileAllowedHostnames: [],
      resendApiKey: 're_key',
      toEmail: 'info@nztsolutions.it',
      fromEmail: 'NZT Solutions <sito@nztsolutions.it>',
      production: true,
      ...overrides.env,
    },
    ipLimiter: createRateLimiter({ limit: 5, windowMs: 600_000 }),
    globalLimiter: createRateLimiter({ limit: 30, windowMs: 3_600_000, maxKeys: 1 }),
    verifyCaptcha,
    sendEmail,
    log: createLogger((line) => lines.push(line)),
    ...overrides.deps,
  });
  const events = () => lines.map((line) => (JSON.parse(line) as { event: string }).event);
  return { handler, verifyCaptcha, sendEmail, lines, events };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://internal/api/contact', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'nztsolutions.it',
      origin: 'https://nztsolutions.it',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const client = { ip: '203.0.113.9', requestId: 'req-1' };

describe('POST /api/contact', () => {
  it('invia l’email per una richiesta valida', async () => {
    const { handler, sendEmail, verifyCaptcha, events } = setup();
    const response = await handler(post(payload), client);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(verifyCaptcha).toHaveBeenCalledWith('token-valido', 'turnstile-secret', {
      remoteIp: '203.0.113.9',
      allowedHostnames: [],
    });
    const [key, email] = sendEmail.mock.calls[0] ?? [];
    expect(key).toBe('re_key');
    expect(email).toMatchObject({ to: 'info@nztsolutions.it', replyTo: 'mario.rossi@example.com' });
    expect(email?.text).toContain('Testo riservato del messaggio');
    expect(events()).toEqual(['contact_sent']);
  });

  it('non scrive mai nei log i dati personali del modulo né le credenziali', async () => {
    const { handler, lines } = setup();
    await handler(post(payload), client);
    await handler(post({ ...payload, name: 'x' }), client);
    const output = lines.join('\n');
    for (const secret of [
      'Mario',
      'mario.rossi@example.com',
      'ACME',
      'Testo riservato',
      '1234567',
      'token-valido',
      'turnstile-secret',
      're_key',
      '203.0.113.9',
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('203.0.113.0/24');
  });

  it('rifiuta Content-Type diversi da JSON (415)', async () => {
    const { handler, sendEmail } = setup();
    const response = await handler(post(payload, { 'content-type': 'text/plain' }), client);
    expect(response.status).toBe(415);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('rifiuta le richieste cross-origin (403)', async () => {
    const { handler, sendEmail, events } = setup();
    const response = await handler(post(payload, { origin: 'https://evil.example' }), client);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: 'forbidden' });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(events()).toEqual(['contact_forbidden_origin']);
  });

  it('limita le richieste per client (429 con Retry-After)', async () => {
    const { handler, events } = setup();
    for (let i = 0; i < 5; i += 1) expect((await handler(post({}), client)).status).toBe(400);
    const limited = await handler(post(payload), client);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(events().at(-1)).toBe('contact_rate_limited');
    // Un altro client non è coinvolto
    expect((await handler(post(payload), { ip: '198.51.100.7', requestId: 'req-2' })).status).toBe(
      200,
    );
  });

  it('rifiuta corpi troppo grandi (413) e JSON malformato (400)', async () => {
    const { handler } = setup();
    const big = await handler(post({ ...payload, message: 'a'.repeat(20_000) }), client);
    expect(big.status).toBe(413);
    expect((await handler(post('{"name":'), client)).status).toBe(400);
  });

  it('rifiuta chiavi extra e tipi non scalari (400), registrando solo i nomi dei campi', async () => {
    const { handler, sendEmail, lines } = setup();
    expect((await handler(post({ ...payload, isAdmin: true }), client)).status).toBe(400);
    expect((await handler(post({ ...payload, email: { $ne: null } }), client)).status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(lines.join('\n')).toContain('"fields":["email"]');
  });

  it('honeypot compilato: successo apparente, nessun invio', async () => {
    const { handler, sendEmail, verifyCaptcha, events } = setup();
    const response = await handler(post({ ...payload, website: 'http://spam.example' }), client);
    expect(response.status).toBe(200);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(verifyCaptcha).not.toHaveBeenCalled();
    expect(events()).toEqual(['contact_honeypot']);
  });

  it('senza token o con captcha rifiutato non invia (400)', async () => {
    const missing = setup();
    const withoutToken: Record<string, unknown> = { ...payload };
    delete withoutToken.turnstileToken;
    expect((await missing.handler(post(withoutToken), client)).status).toBe(400);
    expect(missing.sendEmail).not.toHaveBeenCalled();

    const rejected = setup({
      deps: { verifyCaptcha: async () => ({ ok: false, reason: 'invalid-input-response' }) },
    });
    const response = await rejected.handler(post(payload), client);
    expect(await response.json()).toEqual({ ok: false, error: 'captcha' });
    expect(rejected.sendEmail).not.toHaveBeenCalled();
    expect(rejected.events()).toEqual(['contact_captcha_failed']);
  });

  it('in produzione senza captcha configurato non accetta invii (503)', async () => {
    const { handler, sendEmail } = setup({ env: { turnstileSecret: undefined } });
    expect((await handler(post(payload), client)).status).toBe(503);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('passa a Turnstile gli hostname ammessi', async () => {
    const { handler, verifyCaptcha } = setup({
      env: { turnstileAllowedHostnames: ['nztsolutions.it'] },
    });
    await handler(post(payload), client);
    expect(verifyCaptcha.mock.calls[0]?.[2]).toMatchObject({
      allowedHostnames: ['nztsolutions.it'],
    });
  });

  it('senza chiave Resend risponde 503', async () => {
    const { handler } = setup({ env: { resendApiKey: undefined } });
    expect((await handler(post(payload), client)).status).toBe(503);
  });

  it('applica il tetto globale di invii anche a client diversi', async () => {
    const { handler, sendEmail } = setup({
      deps: { globalLimiter: createRateLimiter({ limit: 2, windowMs: 3_600_000, maxKeys: 1 }) },
    });
    const statuses = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push(
        (await handler(post(payload), { ip: `198.51.100.${i}`, requestId: undefined })).status,
      );
    }
    expect(statuses).toEqual([200, 200, 429, 429]);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it('se l’invio fallisce risponde 502 senza dettagli', async () => {
    const { handler, events } = setup({
      deps: {
        sendEmail: async () => ({ ok: false, status: 500, reason: 'internal_server_error' }),
      },
    });
    const response = await handler(post(payload), client);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ ok: false, error: 'send_failed' });
    expect(events()).toEqual(['contact_send_failed']);
  });

  it('l’oggetto dell’email non contiene mai a capo', async () => {
    const { handler, sendEmail } = setup();
    await handler(post(payload), client);
    expect(sendEmail.mock.calls[0]?.[1].subject).not.toMatch(/[\r\n]/);
  });
});
