import { describe, expect, it } from 'vitest';
import { createTokenStore } from '../src/auth/tokenStore';

describe('in-memory token store', () => {
  it('returns the token until expiry minus skew, then null', () => {
    let now = 1_000_000;
    const store = createTokenStore(() => now);
    expect(store.get()).toBeNull();
    store.set('tok', 600);
    expect(store.get()).toBe('tok');
    expect(store.expiresAt()).toBe(1_000_000 + 600_000);
    now += 594_000;
    expect(store.get()).toBe('tok');
    now += 1_000; // entro i 5 s di margine
    expect(store.get()).toBeNull();
    expect(store.get(0)).toBe('tok');
  });

  it('clear() forgets the token', () => {
    const store = createTokenStore();
    store.set('tok', 600);
    store.clear();
    expect(store.get()).toBeNull();
    expect(store.expiresAt()).toBeNull();
  });

  it('rejects malformed token responses', () => {
    const store = createTokenStore();
    expect(() => store.set('', 600)).toThrow();
    expect(() => store.set('tok', 0)).toThrow();
    expect(() => store.set('tok', Number.NaN)).toThrow();
  });

  it('keeps the token in a closure, not on an enumerable object', () => {
    const store = createTokenStore();
    store.set('secret-token', 600);
    expect(JSON.stringify(store)).not.toContain('secret-token');
    expect(Object.values(store).some((v) => v === 'secret-token')).toBe(false);
  });
});
