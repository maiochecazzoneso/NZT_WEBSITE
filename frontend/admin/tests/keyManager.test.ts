import { describe, expect, it } from 'vitest';
import { createKeyManager } from '../src/auth/keyManager';
import { createMemoryKeyStore, type KeyPairStore } from '../src/auth/keyStore';
import { createMemoryLocks } from './helpers/env';

describe('key manager', () => {
  it('creates once, persists, and reuses the stored key (also across instances = tabs)', async () => {
    const store = createMemoryKeyStore();
    const lock = createMemoryLocks();
    const a = createKeyManager(store, lock);
    expect(await a.get({ create: false })).toBeNull();
    const key = await a.get({ create: true });
    expect(key?.privateKey.extractable).toBe(false);
    const b = createKeyManager(store, lock);
    expect((await b.get({ create: false }))?.jkt).toBe(key?.jkt);
  });

  it('two tabs creating concurrently end up with the same key (creation under lock)', async () => {
    const store = createMemoryKeyStore();
    const lock = createMemoryLocks();
    const [k1, k2] = await Promise.all([
      createKeyManager(store, lock).get({ create: true }),
      createKeyManager(store, lock).get({ create: true }),
    ]);
    expect(k1?.jkt).toBe(k2?.jkt);
  });

  it('discard() removes the persisted key; the next get creates a different one', async () => {
    const store = createMemoryKeyStore();
    const manager = createKeyManager(store, createMemoryLocks());
    const first = await manager.get({ create: true });
    await manager.discard();
    expect(await store.load()).toBeNull();
    const second = await manager.get({ create: true });
    expect(second?.jkt).not.toBe(first?.jkt);
  });

  it('falls back to a memory-only key when the persistent store fails (e.g. IndexedDB blocked)', async () => {
    const broken: KeyPairStore = {
      load: () => Promise.reject(new Error('blocked')),
      save: () => Promise.reject(new Error('blocked')),
      remove: () => Promise.reject(new Error('blocked')),
    };
    const manager = createKeyManager(broken, createMemoryLocks());
    const key = await manager.get({ create: true });
    expect(key).not.toBeNull();
    manager.forgetCached();
    expect((await manager.get({ create: false }))?.jkt).toBe(key?.jkt);
  });
});
