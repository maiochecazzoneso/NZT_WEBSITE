import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCsp, PRODUCTION_API_ORIGIN, securityHeaders, toOrigin } from '../csp.config';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('Content-Security-Policy', () => {
  it('production policy is strict: self scripts/styles only, API-only connect, Trusted Types', () => {
    expect(buildCsp('https://api.nztsolutions.it')).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; " +
        "connect-src https://api.nztsolutions.it; manifest-src 'self'; base-uri 'none'; " +
        "form-action 'self'; frame-ancestors 'none'; object-src 'none'; " +
        "require-trusted-types-for 'script'; trusted-types 'none'",
    );
  });

  it("never allows 'unsafe-inline' / 'unsafe-eval' / wildcards in production", () => {
    const csp = buildCsp(PRODUCTION_API_ORIGIN);
    expect(csp).not.toMatch(/unsafe-|\*|data:|https:(?!\/\/)/);
  });

  it("dev policy differs only by the HMR needs ('unsafe-inline' styles, ws:, no Trusted Types)", () => {
    const dev = buildCsp('http://localhost:8000', { dev: true });
    expect(dev).toContain("style-src 'self' 'unsafe-inline'");
    expect(dev).toContain("connect-src 'self' http://localhost:8000 ws:");
    expect(dev).toContain("script-src 'self'");
    expect(dev).not.toContain('trusted-types');
  });

  it('API base must be a bare origin', () => {
    expect(toOrigin('https://api.nztsolutions.it/')).toBe('https://api.nztsolutions.it');
    expect(() => toOrigin('https://api.nztsolutions.it/v1')).toThrow();
    expect(() => toOrigin('ftp://x')).toThrow();
  });

  it('deploy/_headers and deploy/Caddyfile carry exactly the generated headers', () => {
    const headers = securityHeaders(PRODUCTION_API_ORIGIN);
    const netlify = read('deploy/_headers');
    const caddy = read('deploy/Caddyfile');
    for (const [name, value] of Object.entries(headers)) {
      expect(netlify).toContain(`  ${name}: ${value}\n`);
      expect(caddy).toContain(`\t\t${name} "${value}"\n`);
    }
    expect(headers['X-Robots-Tag']).toBe('noindex, nofollow, noarchive');
  });
});

describe('index.html and robots.txt', () => {
  const html = read('index.html');

  it('has no inline script, inline style or event handler attributes', () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBe(1);
    for (const [, attrs, body] of scripts) {
      expect(attrs).toMatch(/\bsrc=/);
      expect(body?.trim()).toBe('');
    }
    expect(html).not.toMatch(/<style\b/);
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it('is not indexable', () => {
    expect(html).toContain('<meta name="robots" content="noindex, nofollow, noarchive" />');
    expect(html).toContain('<title>Area amministratore');
    expect(html).toContain('<meta name="referrer" content="no-referrer" />');
    expect(read('public/robots.txt')).toBe('User-agent: *\nDisallow: /\n');
  });
});

describe('local Caddyfile (docker compose test stack)', () => {
  it('serves the same security headers with an http :80 site and API connect-src on localhost:8000', () => {
    const caddy = read('deploy/Caddyfile.local');
    expect(caddy).toContain(':80 {');
    expect(caddy).toContain(`\t\tContent-Security-Policy "${buildCsp('http://localhost:8000')}"\n`);
    expect(caddy).toContain('\t\tX-Robots-Tag "noindex, nofollow, noarchive"\n');
    expect(caddy).toContain('\t\tX-Frame-Options "DENY"\n');
  });
});
