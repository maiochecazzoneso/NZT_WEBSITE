import { describe, expect, it } from 'vitest';
import {
  API_CSP,
  apiSecurityHeaders,
  buildPageCsp,
  pageSecurityHeaders,
} from '@server/security-headers.mjs';

const hashes = { scripts: ['sha256-AAAA'], styles: ['sha256-BBBB'] };

const directive = (csp: string, name: string) =>
  csp.split('; ').find((entry) => entry === name || entry.startsWith(`${name} `)) ?? '';

describe('Content Security Policy delle pagine', () => {
  const csp = buildPageCsp(hashes);

  it('non consente mai script inline arbitrari né eval', () => {
    const scriptSrc = directive(csp, 'script-src');
    expect(scriptSrc).toBe("script-src 'self' 'sha256-AAAA' https://challenges.cloudflare.com");
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/script-src[^;]*\*/);
  });

  it('ammette i blocchi <style> solo per hash', () => {
    expect(directive(csp, 'style-src-elem')).toBe("style-src-elem 'self' 'sha256-BBBB'");
  });

  it('blocca framing, plugin, base e destinazioni dei form esterne', () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(directive(csp, 'frame-src')).toBe('frame-src https://challenges.cloudflare.com');
  });

  it('forza HTTPS per le sottorisorse, disattivabile solo in locale', () => {
    expect(csp).toContain('upgrade-insecure-requests');
    expect(buildPageCsp(hashes, { upgradeInsecureRequests: false })).not.toContain(
      'upgrade-insecure-requests',
    );
  });
});

describe('header di sicurezza', () => {
  it('le pagine ricevono tutti gli header difensivi', () => {
    expect(pageSecurityHeaders(hashes)).toMatchObject({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    expect(pageSecurityHeaders(hashes)['Permissions-Policy']).toContain(
      'camera=(), microphone=(), geolocation=(), payment=()',
    );
  });

  it('le API ricevono una CSP chiusa e non vanno in cache', () => {
    expect(API_CSP).toContain("default-src 'none'");
    expect(apiSecurityHeaders()).toMatchObject({
      'Content-Security-Policy': API_CSP,
      'Cache-Control': 'no-store',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
    });
  });
});
