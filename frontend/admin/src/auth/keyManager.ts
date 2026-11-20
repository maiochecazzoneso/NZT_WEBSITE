// Gestione della chiave DPoP corrente: una sola chiave per browser (condivisa tra le schede via
// IndexedDB), creata sotto lock per evitare che due schede generino chiavi diverse in parallelo.

import type { LockRunner } from '../lib/locks';
import { generateDpopKeyPair, toDpopKey, type DpopKey } from './dpop';
import { createMemoryKeyStore, type KeyPairStore } from './keyStore';

export const KEY_LOCK_NAME = 'nzt_admin_dpop_key';

export interface KeyManager {
  /** Chiave corrente; se assente e `create` è true ne genera e persiste una nuova. */
  get(options: { create: boolean }): Promise<DpopKey | null>;
  /** Elimina la chiave persistita (logout): le sessioni legate a essa diventano inutilizzabili. */
  discard(): Promise<void>;
  /** Dimentica la cache della scheda (un'altra scheda ha cambiato la chiave). */
  forgetCached(): void;
}

export function createKeyManager(store: KeyPairStore, lock: LockRunner): KeyManager {
  let active: KeyPairStore = store;
  let cached: DpopKey | null = null;
  const fallback = createMemoryKeyStore();

  function isPermanentIdbFailure(error: unknown): boolean {
    if (typeof indexedDB === 'undefined') return true;
    const name = error instanceof Error ? error.name : '';
    return name === 'SecurityError' || name === 'InvalidStateError';
  }

  async function guarded<T>(op: (s: KeyPairStore) => Promise<T>): Promise<T> {
    try {
      return await op(active);
    } catch (error) {
      // IndexedDB non disponibile in modo deterministico: fallback in memoria.
      if (isPermanentIdbFailure(error)) active = fallback;
      return op(fallback);
    }
  }

  return {
    async get({ create }) {
      if (cached) return cached;
      return lock(KEY_LOCK_NAME, async () => {
        if (cached) return cached;
        let pair = await guarded((s) => s.load());
        if (pair) {
          try {
            cached = await toDpopKey(pair);
            return cached;
          } catch {
            // Chiave corrotta o non conforme: rimuovila e rigenera se consentito.
            await guarded((s) => s.remove());
            pair = null;
          }
        }
        if (!create) return null;
        pair = await generateDpopKeyPair();
        const fresh = pair;
        await guarded((s) => s.save(fresh));
        cached = await toDpopKey(pair);
        return cached;
      });
    },
    async discard() {
      cached = null;
      await lock(KEY_LOCK_NAME, () => guarded((s) => s.remove()));
    },
    forgetCached() {
      cached = null;
    },
  };
}
