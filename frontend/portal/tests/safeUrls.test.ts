import { describe, expect, it } from 'vitest';
import { validateAuthorizationUrl, validateDownloadUrl } from '../src/lib/safeUrls';

const GOOGLE = ['https://accounts.google.com'];

describe('validateAuthorizationUrl', () => {
  it('accepts the configured IdP origin only', () => {
    expect(
      validateAuthorizationUrl('https://accounts.google.com/o/oauth2/v2/auth?client_id=x', GOOGLE),
    ).toBe('https://accounts.google.com/o/oauth2/v2/auth?client_id=x');
    for (const bad of [
      'https://evil.example/o/oauth2',
      'http://accounts.google.com/o/oauth2',
      'javascript:alert(1)',
      'https://user:pw@accounts.google.com/',
      42,
      null,
    ]) {
      expect(() => validateAuthorizationUrl(bad, GOOGLE)).toThrow();
    }
  });

  it('allows http only on loopback (dev / E2E fake IdP)', () => {
    expect(
      validateAuthorizationUrl('http://localhost:9000/authorize', ['http://localhost:9000']),
    ).toBe('http://localhost:9000/authorize');
  });
});

describe('validateDownloadUrl', () => {
  it('accepts https presigned URLs and rejects other schemes', () => {
    const url = 'https://acc.r2.cloudflarestorage.com/nzt-binaries/x.exe?X-Amz-Signature=abc';
    expect(validateDownloadUrl(url)).toBe(url);
    expect(() => validateDownloadUrl('javascript:alert(1)')).toThrow();
    expect(() => validateDownloadUrl('http://storage.example/x')).toThrow();
    expect(() => validateDownloadUrl('data:text/html,hi')).toThrow();
  });
});
