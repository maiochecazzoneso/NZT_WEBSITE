// src/lib/security/rate-limit.ts — rate limit a finestra scorrevole, in memoria, con consumo limitato.
// Memoria limitata per costruzione: al più `limit` timestamp per chiave e al più `maxKeys` chiavi, così
// nemmeno un attacco con moltissimi IP diversi può far crescere la mappa senza controllo.
// Vale per una singola istanza: con più repliche su Railway serve uno store condiviso (Redis, vedi
// docs/architettura_sicurezza_nzt_solutions.md §3.4), implementando la stessa interfaccia `RateLimiter`.

export interface RateLimitDecision {
  limited: boolean;
  /** Secondi dopo i quali la chiave potrà fare una nuova richiesta (0 se non limitata) */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Registra un tentativo per la chiave e dice se va rifiutato. I tentativi rifiutati non vengono contati. */
  hit(key: string, now?: number): RateLimitDecision;
  /** Numero di chiavi attualmente in memoria (per i test e la diagnostica) */
  readonly size: number;
}

export interface RateLimiterOptions {
  /** Richieste ammesse per finestra */
  limit: number;
  /** Durata della finestra in millisecondi */
  windowMs: number;
  /** Numero massimo di chiavi tenute in memoria */
  maxKeys?: number;
}

export function createRateLimiter({
  limit,
  windowMs,
  maxKeys = 10_000,
}: RateLimiterOptions): RateLimiter {
  if (!Number.isInteger(limit) || limit < 1)
    throw new RangeError('limit deve essere un intero ≥ 1');
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new RangeError('windowMs deve essere > 0');
  if (!Number.isInteger(maxKeys) || maxKeys < 1)
    throw new RangeError('maxKeys deve essere un intero ≥ 1');

  // La Map conserva l'ordine di inserimento: la prima chiave è la meno recente
  const hits = new Map<string, number[]>();

  const evict = (now: number) => {
    for (const [key, times] of hits) {
      if (hits.size < maxKeys) return;
      const newest = times[times.length - 1];
      if (newest === undefined || now - newest >= windowMs) hits.delete(key);
    }
    // Tutte le chiavi sono ancora attive: si liberano le più vecchie
    for (const key of hits.keys()) {
      if (hits.size < maxKeys) return;
      hits.delete(key);
    }
  };

  return {
    hit(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);

      if (recent.length >= limit) {
        const oldest = recent[0] ?? now;
        hits.set(key, recent);
        return {
          limited: true,
          retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
        };
      }

      recent.push(now);
      // Reinserimento in coda: la chiave torna a essere la più recente
      hits.delete(key);
      if (hits.size >= maxKeys) evict(now);
      hits.set(key, recent);
      return { limited: false, retryAfterSeconds: 0 };
    },
    get size() {
      return hits.size;
    },
  };
}
