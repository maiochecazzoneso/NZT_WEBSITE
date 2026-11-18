import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '@/lib/security/rate-limit';

describe('rate limiter', () => {
  it('ammette `limit` richieste per finestra e rifiuta le successive', () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000 });
    expect([0, 1, 2].map((t) => limiter.hit('ip', t).limited)).toEqual([false, false, false]);
    const blocked = limiter.hit('ip', 500);
    expect(blocked.limited).toBe(true);
    expect(blocked.retryAfterSeconds).toBe(1);
  });

  it('riammette la chiave quando la finestra è scorsa', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.hit('ip', 0).limited).toBe(false);
    expect(limiter.hit('ip', 999).limited).toBe(true);
    expect(limiter.hit('ip', 1000).limited).toBe(false);
  });

  it('tiene separate le chiavi', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.hit('a', 0).limited).toBe(false);
    expect(limiter.hit('b', 0).limited).toBe(false);
    expect(limiter.hit('a', 1).limited).toBe(true);
  });

  it('non conta i tentativi rifiutati: memoria per chiave limitata a `limit` valori', () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000 });
    for (let t = 0; t < 500; t += 1) limiter.hit('flood', t);
    // Dopo la finestra la chiave riparte da zero, senza strascichi dei 498 tentativi rifiutati
    expect(limiter.hit('flood', 1002).limited).toBe(false);
  });

  it('non supera mai `maxKeys` chiavi, anche con un numero illimitato di sorgenti', () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 60_000, maxKeys: 100 });
    for (let i = 0; i < 10_000; i += 1) limiter.hit(`ip-${i}`, i);
    expect(limiter.size).toBeLessThanOrEqual(100);
  });

  it('libera prima le chiavi scadute', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 2 });
    limiter.hit('vecchia', 0);
    limiter.hit('attiva', 1500);
    limiter.hit('nuova', 1600);
    expect(limiter.hit('attiva', 1700).limited).toBe(true);
  });

  it('rifiuta configurazioni non valide', () => {
    expect(() => createRateLimiter({ limit: 0, windowMs: 1000 })).toThrow(RangeError);
    expect(() => createRateLimiter({ limit: 1, windowMs: 0 })).toThrow(RangeError);
    expect(() => createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 0 })).toThrow(RangeError);
  });
});
