// Server di produzione reale (node server/index.mjs) sul build in dist/. Richiede `pnpm build`.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const SECRET = 'feedface'.repeat(8);
const PAGES = [
  '/',
  '/nzt-enterprise',
  '/privacy-policy',
  '/cookie-policy',
  '/pagina-che-non-esiste',
];

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === 'object' && address ? resolve(address.port) : reject(new Error('porta')),
      );
    });
  });

async function start(env: Record<string, string>) {
  const port = await freePort();
  let output = '';
  const child: ChildProcess = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    env: {
      PATH: process.env.PATH ?? '',
      HOST: '127.0.0.1',
      PORT: String(port),
      NODE_ENV: 'production',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));

  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server terminato all'avvio:\n${output}`);
    const up = await fetch(`${base}/healthz`).then(
      (res) => res.ok,
      () => false,
    );
    if (up) return { base, child, output: () => output };
    await new Promise((wait) => setTimeout(wait, 100));
  }
  child.kill('SIGKILL');
  throw new Error(`server non raggiungibile:\n${output}`);
}

const stop = (child: ChildProcess) =>
  new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });

const sha256 = (content: string) =>
  `'sha256-${createHash('sha256').update(content).digest('base64')}'`;

/** Blocchi inline di una pagina, estratti in modo indipendente da server/csp-hashes.mjs */
function inlineBlocks(html: string) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(
      ([, attrs = '', body = '']) =>
        !/\ssrc=/i.test(attrs) &&
        !/type="application\/(ld\+)?json"/i.test(attrs) &&
        body.length > 0,
    )
    .map(([, , body = '']) => body);
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(
    ([, body = '']) => body,
  );
  return { scripts, styles };
}

const directive = (csp: string, name: string) =>
  csp.split('; ').find((entry) => entry.startsWith(`${name} `)) ?? '';

describe.skipIf(!existsSync(`${root}/dist/server/entry.mjs`))(
  'server di produzione sul build reale',
  () => {
    let open: Awaited<ReturnType<typeof start>>;
    let locked: Awaited<ReturnType<typeof start>>;

    beforeAll(async () => {
      [open, locked] = await Promise.all([start({}), start({ ORIGIN_VERIFY_SECRET: SECRET })]);
    });
    afterAll(async () => {
      await Promise.all([open && stop(open.child), locked && stop(locked.child)]);
    });

    it.each(PAGES)(
      '%s: ogni script e stile inline della pagina è coperto dalla CSP servita',
      async (path) => {
        const response = await fetch(`${open.base}${path}`);
        const csp = response.headers.get('content-security-policy') ?? '';
        const { scripts, styles } = inlineBlocks(await response.text());

        expect(scripts.length + styles.length).toBeGreaterThan(0);
        const scriptSrc = directive(csp, 'script-src');
        const styleSrc = directive(csp, 'style-src-elem');
        for (const script of scripts) expect(scriptSrc).toContain(sha256(script));
        for (const style of styles) expect(styleSrc).toContain(sha256(style));
        expect(scriptSrc).not.toContain('unsafe-inline');
        expect(csp).not.toContain('unsafe-eval');
      },
    );

    it('serve pagine, asset e 404 con tutti gli header di sicurezza', async () => {
      const home = await fetch(`${open.base}/`);
      const assetPath = /\/_astro\/[^"']+\.(?:js|css)/.exec(await home.text())?.[0] ?? '';
      expect(assetPath).not.toBe('');

      for (const [path, status] of [
        ['/', 200],
        [assetPath, 200],
        ['/robots.txt', 200],
        ['/pagina-che-non-esiste', 404],
      ] as const) {
        const response = await fetch(`${open.base}${path}`);
        expect([path, response.status]).toEqual([path, status]);
        expect(response.headers.get('strict-transport-security')).toContain('max-age=31536000');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('x-frame-options')).toBe('DENY');
        expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
        expect(response.headers.get('x-powered-by')).toBeNull();
      }
    });

    it('la pagina 404 è quella del sito e non rivela il framework', async () => {
      const response = await fetch(`${open.base}/pagina-che-non-esiste`);
      const html = await response.text();
      expect(response.status).toBe(404);
      expect(html).toContain('Pagina non trovata');
      expect(html.toLowerCase()).not.toContain('astro.build');
    });

    it('non espone file nascosti né sorgenti', async () => {
      for (const path of [
        '/.env',
        '/.git/config',
        '/package.json',
        '/server/index.mjs',
        '/../server/config.mjs',
        '/dist/server/entry.mjs',
      ]) {
        const response = await fetch(`${open.base}${path}`);
        expect([path, response.status]).toEqual([path, 404]);
      }
    });

    it('blocca gli endpoint interni del framework', async () => {
      for (const path of [
        '/_image?href=%2Ffavicon.svg&w=16&f=avif',
        '/_IMAGE?href=x',
        '/_server-islands/x',
      ]) {
        expect([path, (await fetch(`${open.base}${path}`)).status]).toEqual([path, 404]);
      }
    });

    it('l’API rifiuta richieste cross-origin, non JSON, con chiavi extra, e risponde con CSP chiusa', async () => {
      const url = `${open.base}/api/contact`;
      const valid = {
        name: 'Mario Rossi',
        email: 'mario@example.com',
        company: 'ACME Srl',
        service: 'generale',
        message: '',
      };
      const json = { 'content-type': 'application/json' };

      const crossOrigin = await fetch(url, {
        method: 'POST',
        headers: { ...json, origin: 'https://evil.example' },
        body: JSON.stringify(valid),
      });
      expect(crossOrigin.status).toBe(403);
      expect(crossOrigin.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(crossOrigin.headers.get('cache-control')).toBe('no-store');
      expect(crossOrigin.headers.get('cross-origin-resource-policy')).toBe('same-origin');
      expect(crossOrigin.headers.get('access-control-allow-origin')).toBeNull();

      const form = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'name=x',
      });
      expect([403, 415]).toContain(form.status);

      const extra = await fetch(url, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ ...valid, isAdmin: true }),
      });
      expect(extra.status).toBe(400);
      expect(await extra.json()).toEqual({ ok: false, error: 'invalid' });

      // In produzione senza captcha configurato l'invio resta chiuso
      const noCaptcha = await fetch(url, {
        method: 'POST',
        headers: json,
        body: JSON.stringify(valid),
      });
      expect(noCaptcha.status).toBe(503);

      expect((await fetch(url)).status).toBe(405);
    });

    it('il rate limit non si aggira falsificando gli header di IP', async () => {
      const url = `${open.base}/api/contact`;
      const statuses: number[] = [];
      for (let i = 0; i < 8; i += 1) {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'cf-connecting-ip': `198.51.100.${i}`,
            'x-forwarded-for': `203.0.113.${i}`,
            'x-real-ip': `192.0.2.${i}`,
          },
          body: '{}',
        });
        statuses.push(response.status);
      }
      expect(statuses.at(-1)).toBe(429);
      expect(statuses.filter((status) => status === 429).length).toBeGreaterThanOrEqual(3);
    });

    it('i log sono JSON strutturato e non contengono il segreto', () => {
      const lines = locked.output().trim().split('\n').filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
      expect(locked.output()).not.toContain(SECRET);
      expect(open.output()).toContain('origin_verification_disabled');
    });

    it('con ORIGIN_VERIFY_SECRET attivo l’origine risponde solo a Cloudflare', async () => {
      for (const path of ['/', '/robots.txt', '/api/contact']) {
        expect([path, (await fetch(`${locked.base}${path}`)).status]).toEqual([path, 403]);
      }
      expect((await fetch(`${locked.base}/healthz`)).status).toBe(200);
      const verified = await fetch(`${locked.base}/`, { headers: { 'x-origin-verify': SECRET } });
      expect(verified.status).toBe(200);
      expect(await verified.text()).toContain('NZT Solutions');
    });
  },
);

describe('avvio del server', () => {
  it.skipIf(!existsSync(`${root}/dist/server/entry.mjs`))(
    'non parte con un segreto malformato (fail-fast)',
    async () => {
      await expect(start({ ORIGIN_VERIFY_SECRET: 'non-valido' })).rejects.toThrow(
        /server_start_failed|terminato/,
      );
    },
  );
});
