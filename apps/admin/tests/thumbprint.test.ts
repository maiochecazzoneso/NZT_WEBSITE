import { describe, expect, it } from 'vitest';
import { jwkThumbprint } from '../src/auth/dpop';

describe('jwkThumbprint (RFC 7638)', () => {
  it('matches the RFC 7638 §3.1 RSA example', async () => {
    const jwk = {
      kty: 'RSA',
      n: '0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw',
      e: 'AQAB',
      alg: 'RS256',
      kid: '2011-04-29',
    };
    expect(await jwkThumbprint(jwk)).toBe('NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs');
  });

  it('matches the RFC 9449 §6.1 EC example (jkt)', async () => {
    const jwk = {
      kty: 'EC',
      x: 'l8tFrhx-34tV3hRICRDY9zCkDlpBhF42UQUfWVAWBFs',
      y: '9VE4jf_Ok_o64zbTTlcuNJajHmt6v9TDVrU0CdvGRDA',
      crv: 'P-256',
    };
    expect(await jwkThumbprint(jwk)).toBe('0ZcOCORZNYy-DWpqq30jZyJGHTN0d2HglBV3uiguA4I');
  });

  it('ignores member order and non-required members', async () => {
    const a = await jwkThumbprint({
      y: 'yy',
      x: 'xx',
      crv: 'P-256',
      kty: 'EC',
      kid: 'k',
      use: 'sig',
    });
    const b = await jwkThumbprint({ kty: 'EC', crv: 'P-256', x: 'xx', y: 'yy' });
    expect(a).toBe(b);
  });

  it('rejects unsupported or incomplete keys', async () => {
    await expect(jwkThumbprint({ kty: 'oct', k: 'abc' })).rejects.toThrow();
    await expect(jwkThumbprint({ kty: 'EC', crv: 'P-256', x: 'xx' })).rejects.toThrow();
  });
});
