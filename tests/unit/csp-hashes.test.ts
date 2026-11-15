import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectCspHashes, extractInlineHashes, readCspHashes } from '@server/csp-hashes.mjs';

const hash = (content: string) => `sha256-${createHash('sha256').update(content).digest('base64')}`;

describe('extractInlineHashes', () => {
  it('calcola l’hash degli script inline eseguibili', () => {
    const html = `<head><script>alert(1)</script><script type="module">import "./x.js";</script></head>`;
    expect(extractInlineHashes(html).scripts.sort()).toEqual(
      [hash('alert(1)'), hash('import "./x.js";')].sort(),
    );
  });

  it('ignora gli script esterni e i blocchi di dati', () => {
    const html = [
      '<script src="/_astro/a.js"></script>',
      '<script type="module" src="/_astro/b.js"></script>',
      '<script type="application/ld+json">{"@type":"Organization"}</script>',
      '<script type="application/json">{"a":1}</script>',
    ].join('');
    expect(extractInlineHashes(html).scripts).toEqual([]);
  });

  it('calcola l’hash dei blocchi <style>, anche dentro <noscript>', () => {
    const html = `<style>a{color:red}</style><noscript><style is:inline>b{opacity:1}</style></noscript>`;
    expect(extractInlineHashes(html).styles.sort()).toEqual(
      [hash('a{color:red}'), hash('b{opacity:1}')].sort(),
    );
  });

  it('conserva il contenuto byte per byte (spazi e a capo compresi)', () => {
    const content =
      '\n      if (!location.hash) document.documentElement.classList.add("nav-gate");\n    ';
    expect(extractInlineHashes(`<script>${content}</script>`).scripts).toEqual([hash(content)]);
  });

  it('elimina i duplicati', () => {
    expect(extractInlineHashes('<script>a()</script><script>a()</script>').scripts).toHaveLength(1);
  });
});

describe('collectCspHashes / readCspHashes', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'csp-hashes-'));
    await mkdir(path.join(directory, 'pagina'));
    await writeFile(
      path.join(directory, 'index.html'),
      '<script>home()</script><style>a{}</style>',
    );
    await writeFile(
      path.join(directory, 'pagina', 'index.html'),
      '<script>home()</script><script>altra()</script>',
    );
    await writeFile(path.join(directory, 'script.js'), '<script>nonHtml()</script>');
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('unisce gli hash di tutte le pagine HTML', async () => {
    const result = await collectCspHashes(directory);
    expect(result.pages).toBe(2);
    expect(result.scripts.sort()).toEqual([hash('home()'), hash('altra()')].sort());
    expect(result.styles).toEqual([hash('a{}')]);
  });

  it('rifiuta un file di hash manomesso o malformato', async () => {
    const file = path.join(directory, 'csp-hashes.json');
    await writeFile(file, JSON.stringify({ scripts: [hash('a')], styles: [] }));
    await expect(readCspHashes(file)).resolves.toEqual({ scripts: [hash('a')], styles: [] });

    for (const tampered of [
      { scripts: ["'unsafe-inline'"], styles: [] },
      { scripts: ['sha256-abc; script-src *'], styles: [] },
      { scripts: 'sha256-x', styles: [] },
      { styles: [] },
      null,
    ]) {
      await writeFile(file, JSON.stringify(tampered));
      await expect(readCspHashes(file)).rejects.toThrow();
    }
  });
});
