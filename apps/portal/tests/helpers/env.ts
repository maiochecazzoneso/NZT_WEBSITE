// Ambiente "browser" condiviso tra più SessionManager (= più schede dello stesso browser).

import type { LockRunner } from '../../src/lib/locks';
import { createKeyManager } from '../../src/auth/keyManager';
import { createMemoryKeyStore, type KeyPairStore } from '../../src/auth/keyStore';
import { SessionManager, type AuthChannel, type AuthMessage } from '../../src/auth/session';
import { createTokenStore } from '../../src/auth/tokenStore';
import { apiFetch } from '../../src/api/http';

/** Web Locks finto: coda FIFO esclusiva per nome (come navigator.locks in modalità exclusive). */
export function createMemoryLocks(): LockRunner & { maxHeld: (name: string) => number } {
  const queues = new Map<string, Promise<unknown>>();
  const held = new Map<string, number>();
  const max = new Map<string, number>();
  const runner = (<T>(name: string, task: () => Promise<T>): Promise<T> => {
    const previous = queues.get(name) ?? Promise.resolve();
    const run = previous.then(async () => {
      held.set(name, (held.get(name) ?? 0) + 1);
      max.set(name, Math.max(max.get(name) ?? 0, held.get(name) ?? 0));
      try {
        return await task();
      } finally {
        held.set(name, (held.get(name) ?? 1) - 1);
      }
    });
    queues.set(
      name,
      run.catch(() => undefined),
    );
    return run;
  }) as LockRunner & { maxHeld: (name: string) => number };
  runner.maxHeld = (name) => max.get(name) ?? 0;
  return runner;
}

/** Nessun lock (controllo negativo: dimostra che senza Web Locks scatta la reuse detection). */
export const noLock: LockRunner = (_name, task) => task();

export function createBus() {
  const handlers = new Set<{ owner: number; handler: (m: AuthMessage) => void }>();
  return {
    channelFor(owner: number): AuthChannel {
      return {
        post: (message) => {
          for (const entry of handlers) if (entry.owner !== owner) entry.handler(message);
        },
        subscribe: (handler) => {
          const entry = { owner, handler };
          handlers.add(entry);
          return () => handlers.delete(entry);
        },
      };
    },
  };
}

export interface Browser {
  store: KeyPairStore;
  lock: LockRunner;
  bus: ReturnType<typeof createBus>;
  tabs: number;
}

export function createBrowser(lock: LockRunner = createMemoryLocks()): Browser {
  return { store: createMemoryKeyStore(), lock, bus: createBus(), tabs: 0 };
}

export function openTab(browser: Browser) {
  browser.tabs += 1;
  const tokens = createTokenStore();
  const keys = createKeyManager(browser.store, browser.lock);
  const manager = new SessionManager({
    fetcher: apiFetch,
    keys,
    tokens,
    lock: browser.lock,
    channel: browser.bus.channelFor(browser.tabs),
    timers: { set: () => 0, clear: () => undefined },
  });
  return { manager, tokens, keys };
}
