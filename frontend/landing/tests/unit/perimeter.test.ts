// Perimetro di sicurezza (server/create-server.mjs) davanti a un handler finto al posto di Astro.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServerConfig } from '@server/config.mjs';
import { createSecureServer } from '@server/create-server.mjs';
import { securityPath } from '@server/create-server.mjs';
import { createLogger } from '@server/logger.mjs';
import { getRequestContext } from '@server/request-context.mjs';

const SECRET = 'c0ffee11'.repeat(8);
const hashes = { scripts: ['sha256-AAAA'], styles: ['sha256-BBBB'] };

interface Seen {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  context: ReturnType<typeof getRequestContext>;
}

function startServer(config: Partial<ServerConfig>) {
  const seen: Seen[] = [];
  const lines: string[] = [];
  const server = createSecureServer({
    handler: (req, res) => {
      seen.push({
        method: req.method,
        url: req.url,
        headers: { ...req.headers },
        context: getRequestContext(),
      });
      if (req.url === '/boom') throw new Error('dettaglio interno da non mostrare');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>ok</h1>');
    },
    config: {
      host: '127.0.0.1',
      port: 0,
      production: true,
      originVerifySecret: null,
      trustRailwayProxy: false,
      ...config,
    },
    cspHashes: hashes,
    log: createLogger((line) => lines.push(line)),
  });
  return new Promise<{
    base: string;
    port: number;
    seen: Seen[];
    lines: string[];
    close: () => Promise<void>;
  }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        base: `http://127.0.0.1:${port}`,
        port,
        seen,
        lines,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

/** Richiesta "grezza": consente metodi, path e header che fetch normalizzerebbe o vieterebbe. */
function raw(port: number, options: http.RequestOptions, body?: string) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>(
    (resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, ...options }, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }),
        );
      });
      req.on('error', reject);
      req.end(body);
    },
  );
}

describe('securityPath', () => {
  it('normalizza codifica, maiuscole, barre e segmenti ..', () => {
    expect(securityPath('/_image?href=x')).toBe('/_image');
    expect(securityPath('/_IMAGE/')).toBe('/_image');
    expect(securityPath('/%5Fimage')).toBe('/_image');
    expect(securityPath('/a/../_image')).toBe('/_image');
    expect(securityPath('/a//b/./c')).toBe('/a/b/c');
    expect(securityPath('/api\\contact')).toBe('/api/contact');
    expect(securityPath('/')).toBe('/');
  });

  it('rifiuta URL non decodificabili o con byte nulli', () => {
    expect(securityPath('/%E0%A4%A')).toBeNull();
    expect(securityPath('/a%00b')).toBeNull();
  });
});

describe('perimetro senza verifica dell’origine', () => {
  let app: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    app = await startServer({});
  });
  afterAll(() => app.close());

  it('aggiunge gli header di sicurezza a ogni risposta', async () => {
    const response = await fetch(`${app.base}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain(
      "script-src 'self' 'sha256-AAAA'",
    );
    expect(response.headers.get('content-security-policy')).toContain('upgrade-insecure-requests');
    expect(response.headers.get('strict-transport-security')).toBe(
      'max-age=31536000; includeSubDomains; preload',
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get('x-powered-by')).toBeNull();
    expect(response.headers.get('server')).toBeNull();
  });

  it('mette gli header di sicurezza anche sulle risposte di rifiuto', async () => {
    const response = await fetch(`${app.base}/`, { method: 'DELETE' });
    expect(response.status).toBe(405);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('ammette solo GET/HEAD, e POST solo su /api/contact', async () => {
    const before = app.seen.length;
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE']) {
      const { status, headers } = await raw(app.port, { method, path: '/' });
      expect([method, status]).toEqual([method, 405]);
      expect(headers.allow).toBe('GET, HEAD');
    }
    for (const method of ['PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const { status, headers } = await raw(app.port, { method, path: '/api/contact' });
      expect([method, status]).toEqual([method, 405]);
      expect(headers.allow).toBe('POST');
    }
    expect(app.seen.length).toBe(before);

    const post = await raw(
      app.port,
      { method: 'POST', path: '/api/contact', headers: { 'content-type': 'application/json' } },
      '{}',
    );
    expect(post.status).toBe(200);
    expect((await raw(app.port, { method: 'HEAD', path: '/' })).status).toBe(200);
  });

  it('rende irraggiungibili gli endpoint interni non usati, in ogni variante', async () => {
    const before = app.seen.length;
    for (const path of [
      '/_image?href=/a.png&w=10',
      '/_IMAGE',
      '/%5Fimage',
      '/_image/',
      '/x/../_image',
      '/_server-islands/Componente',
      '/_actions/foo',
    ]) {
      expect([path, (await raw(app.port, { path })).status]).toEqual([path, 404]);
    }
    expect(app.seen.length).toBe(before);
  });

  it('rifiuta richieste malformate prima che raggiungano l’applicazione', async () => {
    const before = app.seen.length;
    expect((await raw(app.port, { path: '//evil.example/' })).status).toBe(400);
    expect((await raw(app.port, { path: '/%E0%A4%A' })).status).toBe(400);
    expect((await raw(app.port, { path: '/a%00b' })).status).toBe(400);
    expect((await raw(app.port, { path: `/${'a'.repeat(3000)}` })).status).toBe(414);
    expect(
      (
        await raw(
          app.port,
          { method: 'GET', path: '/', headers: { 'content-length': '5' } },
          'abcde',
        )
      ).status,
    ).toBe(400);
    expect(app.seen.length).toBe(before);
  });

  it('rifiuta corpi oltre il limite (413) senza leggerli', async () => {
    const before = app.seen.length;
    const headers = { 'content-type': 'application/json', 'content-length': String(64 * 1024) };
    const result = await raw(app.port, { method: 'POST', path: '/api/contact', headers }).catch(
      () => ({ status: 413 }),
    );
    expect(result.status).toBe(413);
    expect(app.seen.length).toBe(before);
  });

  it('non fidandosi di alcun proxy, ignora gli header di IP falsificati', async () => {
    await raw(app.port, {
      path: '/ip',
      headers: {
        'cf-connecting-ip': '1.1.1.1',
        'x-real-ip': '2.2.2.2',
        'x-forwarded-for': '3.3.3.3',
      },
    });
    const context = app.seen.at(-1)?.context;
    expect(context?.clientIp).toBe('127.0.0.1');
    expect(context?.originVerified).toBe(false);
    expect(context?.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('un errore dell’applicazione diventa un 500 generico', async () => {
    const response = await fetch(`${app.base}/boom`);
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal Server Error');
    expect(app.lines.join('\n')).toContain('request_failed');
  });

  it('risponde all’healthcheck senza coinvolgere l’applicazione', async () => {
    const before = app.seen.length;
    const response = await fetch(`${app.base}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(app.seen.length).toBe(before);
  });
});

describe('perimetro con verifica dell’origine (Cloudflare)', () => {
  let app: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    app = await startServer({
      originVerifySecret: Buffer.from(SECRET, 'utf8'),
      trustRailwayProxy: true,
    });
  });
  afterAll(() => app.close());

  it('rifiuta con 403 ogni richiesta senza il segreto, asset compresi', async () => {
    const before = app.seen.length;
    for (const path of ['/', '/_astro/app.js', '/api/contact', '/robots.txt']) {
      const response = await fetch(`${app.base}${path}`);
      expect([path, response.status]).toEqual([path, 403]);
      expect(await response.text()).toBe('Forbidden');
    }
    expect(
      (await fetch(`${app.base}/`, { headers: { 'x-origin-verify': 'sbagliato' } })).status,
    ).toBe(403);
    expect(
      (await fetch(`${app.base}/`, { headers: { 'x-origin-verify': SECRET.slice(0, 63) } })).status,
    ).toBe(403);
    expect(app.seen.length).toBe(before);
    expect(app.lines.join('\n')).toContain('origin_verify_failed');
    expect(app.lines.join('\n')).not.toContain(SECRET);
  });

  it('lascia passare l’healthcheck di Railway senza segreto', async () => {
    expect((await fetch(`${app.base}/healthz`)).status).toBe(200);
  });

  it('con il segreto corretto inoltra la richiesta, ma senza il segreto', async () => {
    const response = await fetch(`${app.base}/pagina`, {
      headers: { 'x-origin-verify': SECRET, 'cf-connecting-ip': '198.51.100.23' },
    });
    expect(response.status).toBe(200);
    const last = app.seen.at(-1);
    expect(last?.headers['x-origin-verify']).toBeUndefined();
    expect(last?.context?.originVerified).toBe(true);
    expect(last?.context?.clientIp).toBe('198.51.100.23');
  });

  it('CF-Connecting-IP vale solo insieme al segreto: non basta a spacciarsi per Cloudflare', async () => {
    const response = await fetch(`${app.base}/`, {
      headers: { 'cf-connecting-ip': '198.51.100.23' },
    });
    expect(response.status).toBe(403);
  });
});

describe('perimetro dietro Railway senza Cloudflare', () => {
  it('usa X-Real-IP di Railway e ignora CF-Connecting-IP scritto dal client', async () => {
    const app = await startServer({ trustRailwayProxy: true });
    try {
      await raw(app.port, {
        path: '/',
        headers: { 'cf-connecting-ip': '1.1.1.1', 'x-real-ip': '203.0.113.50' },
      });
      expect(app.seen.at(-1)?.context?.clientIp).toBe('203.0.113.50');
    } finally {
      await app.close();
    }
  });
});

describe('perimetro in locale', () => {
  it('fuori produzione non forza l’upgrade a HTTPS delle sottorisorse', async () => {
    const app = await startServer({ production: false });
    try {
      const response = await fetch(`${app.base}/`);
      expect(response.headers.get('content-security-policy')).not.toContain(
        'upgrade-insecure-requests',
      );
    } finally {
      await app.close();
    }
  });
});
