import { describe, expect, it } from 'vitest';
import { createLogger, redact } from '@server/logger.mjs';

describe('redact', () => {
  it('maschera i campi che richiamano credenziali, a ogni livello', () => {
    const output = redact({
      password: 'hunter2',
      Authorization: 'Bearer abc',
      turnstileToken: 'tok',
      credit_card: '4111111111111111',
      RESEND_API_KEY: 're_123',
      nested: { cookie: 'sid=1', 'x-origin-verify': 'segreto', safe: 'ok' },
      list: [{ secret: 's' }],
    });
    expect(output).toEqual({
      password: '[REDACTED]',
      Authorization: '[REDACTED]',
      turnstileToken: '[REDACTED]',
      credit_card: '[REDACTED]',
      RESEND_API_KEY: '[REDACTED]',
      nested: { cookie: '[REDACTED]', 'x-origin-verify': '[REDACTED]', safe: 'ok' },
      list: [{ secret: '[REDACTED]' }],
    });
  });

  it('tronca le stringhe lunghe e la profondità eccessiva', () => {
    expect((redact('a'.repeat(5000)) as string).length).toBeLessThan(600);
    expect(JSON.stringify(redact({ a: { b: { c: { d: { e: 1 } } } } }))).toContain('[TRUNCATED]');
  });

  it('riduce gli errori a nome e messaggio (niente stack trace)', () => {
    expect(redact(new TypeError('boom'))).toEqual({ name: 'TypeError', message: 'boom' });
  });
});

describe('createLogger', () => {
  it('scrive una sola riga JSON per evento, anche con a capo nei valori (log injection)', () => {
    const lines: string[] = [];
    const log = createLogger((line) => lines.push(line));
    log('warn', 'contact_captcha_failed', {
      reason: 'x\n{"level":"info","event":"falso"}',
      token: 'abc',
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('\n');
    const record = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
    expect(record).toMatchObject({
      level: 'warn',
      event: 'contact_captcha_failed',
      token: '[REDACTED]',
    });
    expect(typeof record.time).toBe('string');
  });
});
