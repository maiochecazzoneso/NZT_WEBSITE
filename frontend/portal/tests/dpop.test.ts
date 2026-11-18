import { createHash, createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  accessTokenHash,
  createDpopProof,
  generateDpopKeyPair,
  normalizeHtu,
  toDpopKey,
} from '../src/auth/dpop';
import { base64UrlDecode } from '../src/lib/base64url';
import { thumbprintNode } from './helpers/fakeApi';

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(part))) as Record<string, unknown>;
}

async function newKey() {
  return toDpopKey(await generateDpopKeyPair());
}

describe('DPoP key', () => {
  it('generates a non-extractable ECDSA P-256 private key', async () => {
    const pair = await generateDpopKeyPair();
    expect(pair.privateKey.extractable).toBe(false);
    expect(pair.privateKey.algorithm).toMatchObject({ name: 'ECDSA', namedCurve: 'P-256' });
    await expect(crypto.subtle.exportKey('jwk', pair.privateKey)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('pkcs8', pair.privateKey)).rejects.toThrow();
  });

  it('refuses an extractable private key', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ]);
    await expect(toDpopKey(pair)).rejects.toThrow(/non-extractable/);
  });

  it('exposes only the public members kty/crv/x/y and the RFC 7638 thumbprint', async () => {
    const key = await newKey();
    expect(Object.keys(key.jwk).sort()).toEqual(['crv', 'kty', 'x', 'y']);
    expect(key.jwk).toMatchObject({ kty: 'EC', crv: 'P-256' });
    expect(key.jkt).toBe(thumbprintNode({ ...key.jwk }));
    expect(key.jkt).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('createDpopProof', () => {
  it('builds a dpop+jwt ES256 proof verifiable with the embedded jwk (WebCrypto + node:crypto)', async () => {
    const key = await newKey();
    const proof = await createDpopProof(key, {
      method: 'post',
      url: 'https://api.nztsolutions.it/api/v1/auth/login?x=1#frag',
    });
    const [h, p, s] = proof.split('.') as [string, string, string];
    const header = decodePart(h);
    const claims = decodePart(p);
    expect(header).toEqual({ typ: 'dpop+jwt', alg: 'ES256', jwk: key.jwk });
    expect(claims.htm).toBe('POST');
    expect(claims.htu).toBe('https://api.nztsolutions.it/api/v1/auth/login');
    expect(claims).not.toHaveProperty('ath');
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(Math.abs((claims.iat as number) - Date.now() / 1000)).toBeLessThan(5);

    const signature = base64UrlDecode(s);
    expect(signature.byteLength).toBe(64); // r||s (IEEE P1363) = JWS ES256
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      header.jwk as JsonWebKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const data = new TextEncoder().encode(`${h}.${p}`);
    expect(
      await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, data),
    ).toBe(true);
    const nodeKey = createPublicKey({ key: header.jwk as never, format: 'jwk' });
    expect(
      verify(
        'sha256',
        Buffer.from(`${h}.${p}`),
        { key: nodeKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature),
      ),
    ).toBe(true);
    // Firma alterata => non verifica
    const tampered = Buffer.from(signature);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    expect(
      verify(
        'sha256',
        Buffer.from(`${h}.${p}`),
        { key: nodeKey, dsaEncoding: 'ieee-p1363' },
        tampered,
      ),
    ).toBe(false);
  });

  it('adds ath = base64url(SHA-256(access token)) only when an access token is sent', async () => {
    const key = await newKey();
    const token = 'eyJhbGciOiJFZERTQSJ9.payload.signature';
    const proof = await createDpopProof(key, {
      method: 'GET',
      url: 'https://api.nztsolutions.it/api/v1/downloads/launcher',
      accessToken: token,
    });
    const claims = decodePart(proof.split('.')[1] as string);
    const expected = createHash('sha256').update(token).digest('base64url');
    expect(claims.ath).toBe(expected);
    expect(await accessTokenHash(token)).toBe(expected);
  });

  it('uses a fresh jti for every proof and the injected clock for iat', async () => {
    const key = await newKey();
    const jtis = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const proof = await createDpopProof(key, { method: 'POST', url: 'https://a.example/x' });
      jtis.add(String(decodePart(proof.split('.')[1] as string).jti));
    }
    expect(jtis.size).toBe(20);
    const fixed = await createDpopProof(key, {
      method: 'POST',
      url: 'https://a.example/x',
      now: () => 1_700_000_000_999,
      jti: () => 'fixed-jti-123',
    });
    expect(decodePart(fixed.split('.')[1] as string)).toMatchObject({
      iat: 1_700_000_000,
      jti: 'fixed-jti-123',
    });
  });

  it('normalizes htu by dropping query and fragment only', () => {
    expect(normalizeHtu('http://localhost:18080/api/v1/auth/refresh?a=b#c')).toBe(
      'http://localhost:18080/api/v1/auth/refresh',
    );
    expect(normalizeHtu('https://API.nztsolutions.it:443/api/v1/x')).toBe(
      'https://api.nztsolutions.it/api/v1/x',
    );
  });
});
