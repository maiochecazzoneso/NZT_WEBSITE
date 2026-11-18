import { describe, expect, it } from 'vitest';
import {
  isJsonContentType,
  isSameOriginRequest,
  readJsonBody,
} from '@/lib/security/request-guards';

const request = (headers: Record<string, string>, body?: BodyInit) =>
  new Request('http://internal/api/contact', { method: 'POST', headers, body });

describe('isJsonContentType', () => {
  it('accetta solo application/json', () => {
    expect(isJsonContentType(request({ 'content-type': 'application/json' }))).toBe(true);
    expect(isJsonContentType(request({ 'content-type': 'Application/JSON; charset=utf-8' }))).toBe(
      true,
    );
    for (const type of [
      'text/plain',
      'application/x-www-form-urlencoded',
      'multipart/form-data',
      'text/plain; application/json',
    ]) {
      expect(isJsonContentType(request({ 'content-type': type }))).toBe(false);
    }
    expect(isJsonContentType(new Request('http://internal/', { method: 'POST' }))).toBe(false);
  });
});

describe('isSameOriginRequest (anti-CSRF)', () => {
  it('accetta la stessa origine', () => {
    expect(
      isSameOriginRequest(
        request({
          host: 'nztsolutions.it',
          origin: 'https://nztsolutions.it',
          'sec-fetch-site': 'same-origin',
        }),
      ),
    ).toBe(true);
    expect(
      isSameOriginRequest(request({ host: 'localhost:4321', origin: 'http://localhost:4321' })),
    ).toBe(true);
  });

  it('accetta l’host pubblico inoltrato dal proxy', () => {
    expect(
      isSameOriginRequest(
        request({
          host: 'internal:8080',
          'x-forwarded-host': 'nztsolutions.it',
          origin: 'https://nztsolutions.it',
        }),
      ),
    ).toBe(true);
  });

  it('rifiuta un’altra origine', () => {
    expect(
      isSameOriginRequest(request({ host: 'nztsolutions.it', origin: 'https://evil.example' })),
    ).toBe(false);
    expect(
      isSameOriginRequest(
        request({ host: 'nztsolutions.it', origin: 'https://nztsolutions.it.evil.example' }),
      ),
    ).toBe(false);
    expect(isSameOriginRequest(request({ host: 'nztsolutions.it', origin: 'null' }))).toBe(false);
  });

  it('rifiuta Sec-Fetch-Site diverso da same-origin anche con Origin corretto', () => {
    for (const site of ['cross-site', 'same-site', 'none']) {
      expect(
        isSameOriginRequest(
          request({
            host: 'nztsolutions.it',
            origin: 'https://nztsolutions.it',
            'sec-fetch-site': site,
          }),
        ),
      ).toBe(false);
    }
  });

  it('non blocca i client senza header di origine (non sono un vettore CSRF)', () => {
    expect(isSameOriginRequest(request({ host: 'nztsolutions.it' }))).toBe(true);
  });
});

describe('readJsonBody', () => {
  const json = { 'content-type': 'application/json' };

  it('legge un JSON entro il limite', async () => {
    expect(await readJsonBody(request(json, '{"a":1}'), 100)).toEqual({
      ok: true,
      value: { a: 1 },
    });
  });

  it('rifiuta un Content-Length dichiarato oltre il limite senza leggere il corpo', async () => {
    const result = await readJsonBody(request({ ...json, 'content-length': '999999' }, '{}'), 100);
    expect(result).toEqual({ ok: false, reason: 'too_large' });
  });

  it('interrompe la lettura di un corpo in streaming oltre il limite', async () => {
    let produced = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced += 1;
        controller.enqueue(new Uint8Array(64).fill(97));
      },
    });
    const streamed = new Request('http://internal/api/contact', {
      method: 'POST',
      headers: json,
      body: stream,
      // @ts-expect-error opzione di Node per i corpi in streaming
      duplex: 'half',
    });
    expect(await readJsonBody(streamed, 1000)).toEqual({ ok: false, reason: 'too_large' });
    expect(produced).toBeLessThan(40);
  });

  it('rifiuta JSON malformato, UTF-8 non valido e corpo assente', async () => {
    expect(await readJsonBody(request(json, '{"a":'), 100)).toEqual({
      ok: false,
      reason: 'invalid_json',
    });
    expect(await readJsonBody(request(json, new Uint8Array([0xff, 0xfe, 0x7b])), 100)).toEqual({
      ok: false,
      reason: 'invalid_json',
    });
    expect(await readJsonBody(new Request('http://internal/', { method: 'POST' }), 100)).toEqual({
      ok: false,
      reason: 'invalid_json',
    });
  });
});
