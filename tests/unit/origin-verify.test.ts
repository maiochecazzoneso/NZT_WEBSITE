import { describe, expect, it } from 'vitest';
import { loadConfig } from '@server/config.mjs';
import { isOriginVerified } from '@server/origin-verify.mjs';

const SECRET = 'a1b2c3d4'.repeat(8);
const secret = Buffer.from(SECRET, 'utf8');

describe('isOriginVerified', () => {
  it('accetta solo il segreto esatto', () => {
    expect(isOriginVerified(SECRET, secret)).toBe(true);
    expect(isOriginVerified(SECRET.toUpperCase(), secret)).toBe(true);
    expect(isOriginVerified(`${SECRET.slice(0, -1)}0`, secret)).toBe(false);
    expect(isOriginVerified(SECRET.slice(0, 32), secret)).toBe(false);
    expect(isOriginVerified(`${SECRET}00`, secret)).toBe(false);
  });

  it('rifiuta header assente, vuoto, ripetuto o abnorme', () => {
    expect(isOriginVerified(undefined, secret)).toBe(false);
    expect(isOriginVerified('', secret)).toBe(false);
    expect(isOriginVerified([SECRET, SECRET], secret)).toBe(false);
    expect(isOriginVerified('a'.repeat(10_000), secret)).toBe(false);
  });
});

describe('loadConfig', () => {
  it('senza segreto lascia la verifica dell’origine disattivata', () => {
    const config = loadConfig({});
    expect(config.originVerifySecret).toBeNull();
    expect(config.port).toBe(8080);
    expect(config.trustRailwayProxy).toBe(false);
  });

  it('accetta un segreto di 64 caratteri esadecimali', () => {
    const config = loadConfig({
      ORIGIN_VERIFY_SECRET: SECRET.toUpperCase(),
      PORT: '3000',
      NODE_ENV: 'production',
    });
    expect(config.originVerifySecret?.toString('utf8')).toBe(SECRET);
    expect(config.port).toBe(3000);
    expect(config.production).toBe(true);
  });

  it('blocca l’avvio con un segreto malformato, senza riportarne il valore', () => {
    for (const bad of ['troppo-corto', 'g'.repeat(64), SECRET.slice(1)]) {
      expect(() => loadConfig({ ORIGIN_VERIFY_SECRET: bad })).toThrow(/64 caratteri esadecimali/);
      try {
        loadConfig({ ORIGIN_VERIFY_SECRET: bad });
      } catch (error) {
        expect(String(error)).not.toContain(bad);
      }
    }
  });

  it('blocca l’avvio con una porta non valida', () => {
    for (const port of ['0', '70000', 'abc', '80.5']) {
      expect(() => loadConfig({ PORT: port })).toThrow(/PORT/);
    }
  });

  it('riconosce l’ambiente Railway', () => {
    expect(loadConfig({ RAILWAY_ENVIRONMENT_NAME: 'production' }).trustRailwayProxy).toBe(true);
  });
});
