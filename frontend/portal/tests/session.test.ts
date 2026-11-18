import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/http';
import { FakeApi } from './helpers/fakeApi';
import { createBrowser, createMemoryLocks, noLock, openTab } from './helpers/env';

let api: FakeApi;
const storageAccess: string[] = [];

function trap(name: string) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        storageAccess.push(`${name}.${String(prop)}`);
        throw new Error(`${name} must not be used`);
      },
    },
  );
}

beforeEach(() => {
  api = new FakeApi();
  storageAccess.length = 0;
  vi.stubGlobal('fetch', api.fetch);
  vi.stubGlobal('localStorage', trap('localStorage'));
  vi.stubGlobal('sessionStorage', trap('sessionStorage'));
  vi.stubGlobal('document', trap('document'));
});

describe('login / register', () => {
  it('logs in with a DPoP proof, keeps the token in memory and persists only the non-extractable key', async () => {
    const browser = createBrowser();
    const tab = openTab(browser);
    await tab.manager.start();
    expect(tab.manager.getSnapshot().status).toBe('unauthenticated');
    expect(api.calls).toHaveLength(0); // nessuna chiave => nessun refresh inutile

    await tab.manager.login('mario@example.com', 'SuperSecurePassword123!');
    expect(tab.manager.getSnapshot().status).toBe('authenticated');
    expect(tab.tokens.get()).toMatch(/^at\./);
    const stored = await browser.store.load();
    expect(stored?.privateKey.extractable).toBe(false);
    expect(api.families[0]?.jkt).toBe((await tab.keys.get({ create: false }))?.jkt);
    expect(api.proofErrors).toEqual([]);
    expect(storageAccess).toEqual([]);
  });

  it('maps a wrong password to ApiError 401 and does not leave a freshly created key behind', async () => {
    const browser = createBrowser();
    const tab = openTab(browser);
    await tab.manager.start();
    await expect(tab.manager.login('mario@example.com', 'wrong')).rejects.toMatchObject({
      status: 401,
      detail: 'Invalid email or password',
    });
    expect(tab.manager.getSnapshot().status).toBe('unauthenticated');
    expect(await browser.store.load()).toBeNull();
  });

  it('registers and is authenticated', async () => {
    const tab = openTab(createBrowser());
    await tab.manager.start();
    await tab.manager.register('new@example.com', 'AnotherPassword42!');
    expect(tab.manager.getSnapshot().status).toBe('authenticated');
  });
});

describe('silent refresh after reload', () => {
  it('restores the session in a new tab instance using the persisted key + cookie', async () => {
    const browser = createBrowser();
    const first = openTab(browser);
    await first.manager.start();
    await first.manager.login('mario@example.com', 'SuperSecurePassword123!');

    const reloaded = openTab(browser); // nuova memoria (reload), stesso IndexedDB e cookie jar
    await reloaded.manager.start();
    expect(reloaded.manager.getSnapshot().status).toBe('authenticated');
    expect(api.countCalls('/api/v1/auth/refresh')).toBe(1);
    expect(reloaded.tokens.get()).not.toBe(first.tokens.get());
  });

  it('refresh rejected (401) => unauthenticated and the stale key is discarded', async () => {
    const browser = createBrowser();
    const tab = openTab(browser);
    await tab.manager.start();
    await tab.manager.login('mario@example.com', 'SuperSecurePassword123!');
    api.jar = null; // cookie scaduto/cancellato
    expect(await tab.manager.refresh()).toBe(false);
    expect(tab.manager.getSnapshot()).toEqual({ status: 'unauthenticated', notice: 'expired' });
    expect(await browser.store.load()).toBeNull();
  });
});

describe('refresh orchestration (Web Locks, spec §6.4)', () => {
  it('deduplicates concurrent refresh calls inside one tab: one network request', async () => {
    const browser = createBrowser();
    const tab = openTab(browser);
    await tab.manager.start();
    await tab.manager.login('mario@example.com', 'SuperSecurePassword123!');
    const results = await Promise.all(Array.from({ length: 5 }, () => tab.manager.refresh()));
    expect(results).toEqual([true, true, true, true, true]);
    expect(api.countCalls('/api/v1/auth/refresh')).toBe(1);
  });

  it('serializes refreshes across tabs: never concurrent, no reuse detection, every tab authenticated', async () => {
    const lock = createMemoryLocks();
    const browser = createBrowser(lock);
    const tabs = Array.from({ length: 4 }, () => openTab(browser));
    await tabs[0]!.manager.start();
    await tabs[0]!.manager.login('mario@example.com', 'SuperSecurePassword123!');
    await Promise.all(tabs.map((tab) => tab.manager.refresh()));
    await Promise.all(tabs.map((tab) => tab.manager.refresh()));
    expect(api.maxConcurrentRefresh).toBe(1);
    expect(api.reuseDetected).toBe(0);
    expect(api.countCalls('/api/v1/auth/refresh')).toBe(8);
    for (const tab of tabs) expect(tab.manager.getSnapshot().status).toBe('authenticated');
    expect(lock.maxHeld('nzt_token_refresh')).toBe(1);
  });

  it('negative control: WITHOUT the lock concurrent tabs trip the reuse detection', async () => {
    const browser = createBrowser(noLock);
    const tabs = Array.from({ length: 2 }, () => openTab(browser));
    await tabs[0]!.manager.start();
    await tabs[0]!.manager.login('mario@example.com', 'SuperSecurePassword123!');
    await Promise.all(tabs.map((tab) => tab.manager.refresh()));
    expect(api.maxConcurrentRefresh).toBe(2);
    expect(api.reuseDetected).toBe(1);
  });
});

describe('protected requests', () => {
  it('sends Authorization: DPoP + proof with ath; retries once after refresh on 401', async () => {
    const browser = createBrowser();
    const tab = openTab(browser);
    await tab.manager.start();
    await tab.manager.login('mario@example.com', 'SuperSecurePassword123!');
    const ok = await tab.manager.authorizedFetch<{ version: string }>({
      method: 'GET',
      path: '/api/v1/downloads/launcher',
    });
    expect(ok.data?.version).toBe('1.2.0');

    api.accessTokens.clear(); // il server non riconosce più l'access token corrente
    const retried = await tab.manager.authorizedFetch<{ version: string }>({
      method: 'GET',
      path: '/api/v1/downloads/launcher',
    });
    expect(retried.data?.version).toBe('1.2.0');
    expect(api.countCalls('/api/v1/auth/refresh')).toBe(1);
    expect(api.proofErrors).toEqual([]);
  });

  it('a second 401 after the refresh ends the session', async () => {
    const tab = openTab(createBrowser());
    await tab.manager.start();
    await tab.manager.login('mario@example.com', 'SuperSecurePassword123!');
    const original = api.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/downloads/launcher')) {
        return new Response(JSON.stringify({ detail: 'Invalid access token' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return original(input, init);
    });
    await expect(
      tab.manager.authorizedFetch({ method: 'GET', path: '/api/v1/downloads/launcher' }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(tab.manager.getSnapshot()).toEqual({ status: 'unauthenticated', notice: 'expired' });
  });

  it('403 without entitlement is surfaced, session stays authenticated', async () => {
    const tab = openTab(createBrowser());
    await tab.manager.start();
    await tab.manager.login('mario@example.com', 'SuperSecurePassword123!');
    api.entitled = false;
    await expect(
      tab.manager.authorizedFetch({ method: 'GET', path: '/api/v1/downloads/launcher' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(tab.manager.getSnapshot().status).toBe('authenticated');
  });
});

describe('logout', () => {
  it('calls POST /logout with DPoP, clears memory, deletes the key and logs out other tabs', async () => {
    const browser = createBrowser();
    const a = openTab(browser);
    const b = openTab(browser);
    await a.manager.start();
    await a.manager.login('mario@example.com', 'SuperSecurePassword123!');
    await b.manager.start();
    expect(b.manager.getSnapshot().status).toBe('authenticated');

    await a.manager.logout();
    expect(api.countCalls('/api/v1/auth/logout')).toBe(1);
    expect(api.calls.find((c) => c.path === '/api/v1/auth/logout')?.status).toBe(204);
    expect(a.tokens.get()).toBeNull();
    expect(await browser.store.load()).toBeNull();
    expect(a.manager.getSnapshot().status).toBe('unauthenticated');
    expect(b.manager.getSnapshot().status).toBe('unauthenticated');
    expect(b.tokens.get()).toBeNull();
    expect(api.families.every((f) => f.revoked)).toBe(true);

    // Nuovo login => nuova chiave (jkt diverso: sessioni non correlabili)
    b.manager.stop();
    await a.manager.login('mario@example.com', 'SuperSecurePassword123!');
    expect(api.families[1]?.jkt).not.toBe(api.families[0]?.jkt);
  });

  it('still discards the key when the server is unreachable', async () => {
    const browser = createBrowser();
    const tab = openTab(browser);
    await tab.manager.start();
    await tab.manager.login('mario@example.com', 'SuperSecurePassword123!');
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await tab.manager.logout();
    expect(await browser.store.load()).toBeNull();
    expect(tab.manager.getSnapshot().status).toBe('unauthenticated');
  });
});

describe('web storage', () => {
  it('a full flow never touches localStorage, sessionStorage or document.cookie', async () => {
    const browser = createBrowser();
    const tab = openTab(browser);
    await tab.manager.start();
    await tab.manager.login('mario@example.com', 'SuperSecurePassword123!');
    await tab.manager.refresh();
    await tab.manager.authorizedFetch({ method: 'GET', path: '/api/v1/downloads/launcher' });
    await tab.manager.logout();
    expect(storageAccess).toEqual([]);
  });
});
