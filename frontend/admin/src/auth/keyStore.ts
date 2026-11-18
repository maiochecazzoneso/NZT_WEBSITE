// Persistenza della coppia di chiavi DPoP in IndexedDB.
//
// AGGIUNTA alla spec §6: il refresh token è legato al jkt della chiave; senza persistenza un reload
// della pagina renderebbe inutilizzabile la sessione. IndexedDB conserva gli oggetti CryptoKey per
// structured clone mantenendo extractable=false: il materiale privato non è mai leggibile da JS.
// Modello di minaccia: uno script XSS può USARE la chiave (firmare prove) finché gira nella pagina,
// ma non può ESFILTRARLA; cookie di refresh e chiave rubati separatamente sono inutili.

export interface KeyPairStore {
  load(): Promise<CryptoKeyPair | null>;
  save(pair: CryptoKeyPair): Promise<void>;
  remove(): Promise<void>;
}

const DB_NAME = 'nzt-admin';
const DB_VERSION = 1;
const STORE = 'dpop-keys';
const RECORD_ID = 'current';

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

function isKeyPair(value: unknown): value is CryptoKeyPair {
  if (typeof value !== 'object' || value === null) return false;
  const pair = value as Partial<CryptoKeyPair>;
  return pair.privateKey instanceof CryptoKey && pair.publicKey instanceof CryptoKey;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    const tx = db.transaction(STORE, mode);
    const result = await promisify(action(tx.objectStore(STORE)));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
    return result;
  } finally {
    db.close();
  }
}

export const indexedDbKeyStore: KeyPairStore = {
  async load() {
    const value: unknown = await withStore('readonly', (store) => store.get(RECORD_ID));
    return isKeyPair(value) ? value : null;
  },
  async save(pair) {
    await withStore('readwrite', (store) => store.put(pair, RECORD_ID));
  },
  async remove() {
    await withStore('readwrite', (store) => store.delete(RECORD_ID));
  },
};

/** Ripiego se IndexedDB non è disponibile: la chiave vive solo nella scheda (niente sessione al reload). */
export function createMemoryKeyStore(): KeyPairStore {
  let pair: CryptoKeyPair | null = null;
  return {
    load: async () => pair,
    save: async (next) => {
      pair = next;
    },
    remove: async () => {
      pair = null;
    },
  };
}
