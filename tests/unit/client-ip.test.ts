import { describe, expect, it } from 'vitest';
import { anonymizeIp, rateLimitKey, resolveClientIp } from '@server/client-ip.mjs';

const spoofed = {
  'cf-connecting-ip': '1.1.1.1',
  'x-real-ip': '2.2.2.2',
  'x-forwarded-for': '3.3.3.3, 4.4.4.4',
};

describe('resolveClientIp', () => {
  it('senza proxy fidati ignora ogni header e usa la connessione TCP', () => {
    const ip = resolveClientIp({
      headers: spoofed,
      socketAddress: '203.0.113.9',
      originVerified: false,
      trustRailwayProxy: false,
    });
    expect(ip).toBe('203.0.113.9');
  });

  it('dietro Railway usa X-Real-IP ma non CF-Connecting-IP (scrivibile dal client)', () => {
    const ip = resolveClientIp({
      headers: spoofed,
      socketAddress: '10.0.0.1',
      originVerified: false,
      trustRailwayProxy: true,
    });
    expect(ip).toBe('2.2.2.2');
  });

  it('usa CF-Connecting-IP solo se la richiesta è passata da Cloudflare', () => {
    const ip = resolveClientIp({
      headers: spoofed,
      socketAddress: '10.0.0.1',
      originVerified: true,
      trustRailwayProxy: true,
    });
    expect(ip).toBe('1.1.1.1');
  });

  it('scarta valori che non sono indirizzi IP', () => {
    const headers = { 'cf-connecting-ip': '1.1.1.1\r\nX-Injected: 1', 'x-real-ip': 'not-an-ip' };
    const ip = resolveClientIp({
      headers,
      socketAddress: '::ffff:203.0.113.9',
      originVerified: true,
      trustRailwayProxy: true,
    });
    expect(ip).toBe('203.0.113.9');
  });

  it('restituisce "unknown" se non c’è alcun indirizzo', () => {
    expect(
      resolveClientIp({
        headers: {},
        socketAddress: undefined,
        originVerified: false,
        trustRailwayProxy: false,
      }),
    ).toBe('unknown');
  });
});

describe('rateLimitKey', () => {
  it('usa l’IPv4 intero', () => {
    expect(rateLimitKey('203.0.113.9')).toBe('203.0.113.9');
    expect(rateLimitKey('::ffff:203.0.113.9')).toBe('203.0.113.9');
  });

  it('raggruppa gli IPv6 per /64: ruotare l’indirizzo non aggira il limite', () => {
    const a = rateLimitKey('2001:db8:abcd:12::1');
    const b = rateLimitKey('2001:0db8:abcd:0012:ffff:ffff:ffff:ffff');
    expect(a).toBe('2001:db8:abcd:12::/64');
    expect(b).toBe(a);
    expect(rateLimitKey('2001:db8:abcd:13::1')).not.toBe(a);
  });
});

describe('anonymizeIp', () => {
  it('tronca gli indirizzi prima di scriverli nei log', () => {
    expect(anonymizeIp('203.0.113.9')).toBe('203.0.113.0/24');
    expect(anonymizeIp('2001:db8:abcd:12::1')).toBe('2001:db8:abcd::/48');
    expect(anonymizeIp('::1')).toBe('0:0:0::/48');
    expect(anonymizeIp('non-un-ip')).toBe('unknown');
  });
});
