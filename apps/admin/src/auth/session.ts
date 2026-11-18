// Orchestrazione della sessione amministratore (stesso modello del portale clienti): login, refresh silenzioso, rinnovo
// anticipato, retry singolo su 401, logout. Tutte le operazioni che leggono o riscrivono il cookie di
// refresh (login, refresh, logout) sono serializzate con lo STESSO Web Lock
// `nzt_admin_token_refresh` tra tutte le schede del browser.
//
// Perché basta il lock (e non serve "riusare" il refresh di un'altra scheda): l'access token vive solo
// nella memoria di ciascuna scheda, quindi ogni scheda deve ottenere il proprio con una rotazione.
// Con RTR + reuse detection due rotazioni SEQUENZIALI sono corrette (la seconda presenta il cookie
// appena ruotato dalla prima, che il browser ha già salvato prima del rilascio del lock); due rotazioni
// CONCORRENTI presenterebbero lo stesso cookie e la seconda verrebbe trattata come riuso, revocando
// tutte le sessioni dell'utente (D-A8 del backend). Il lock rende impossibile il caso concorrente.

import { ApiError, type ApiFetcher, type ApiResponse } from '../api/http';
import { REFRESH_LEEWAY_SECONDS } from '../config';
import type { LockRunner } from '../lib/locks';
import type { KeyManager } from './keyManager';
import type { TokenStore } from './tokenStore';

export const REFRESH_LOCK_NAME = 'nzt_admin_token_refresh';
export const ADMIN_AUTH_PATHS = {
  login: '/api/v1/admin/auth/login',
  refresh: '/api/v1/admin/auth/refresh',
  logout: '/api/v1/admin/auth/logout',
} as const;
export const AUTH_CHANNEL_NAME = 'nzt_admin_auth';

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';
export type SessionNotice = 'expired' | 'unavailable' | null;

export interface SessionSnapshot {
  status: SessionStatus;
  notice: SessionNotice;
}

export type AuthMessage = 'login' | 'logout';

export interface AuthChannel {
  post(message: AuthMessage): void;
  subscribe(handler: (message: AuthMessage) => void): () => void;
}

export interface Timers {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export interface SessionDeps {
  fetcher: ApiFetcher;
  keys: KeyManager;
  tokens: TokenStore;
  lock: LockRunner;
  channel?: AuthChannel | null;
  timers?: Timers;
  now?: () => number;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

const defaultTimers: Timers = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function isUnauthorized(error: unknown): error is ApiError {
  return error instanceof ApiError && error.kind === 'http' && error.status === 401;
}

export class SessionManager {
  private snapshot: SessionSnapshot = { status: 'loading', notice: null };
  private readonly listeners = new Set<() => void>();
  private refreshInFlight: Promise<boolean> | null = null;
  private timer: unknown = null;
  /** Incrementato a ogni logout: i refresh avviati prima vengono scartati. */
  private generation = 0;
  private unsubscribeChannel: (() => void) | null = null;
  private readonly timers: Timers;
  private readonly now: () => number;

  constructor(private readonly deps: SessionDeps) {
    this.timers = deps.timers ?? defaultTimers;
    this.now = deps.now ?? Date.now;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): SessionSnapshot => this.snapshot;

  /** Avvio dell'app (anche dopo un reload): ripristina la sessione se esiste una chiave persistita. */
  async start(options: { restore?: boolean } = {}): Promise<void> {
    if (!this.unsubscribeChannel && this.deps.channel) {
      this.unsubscribeChannel = this.deps.channel.subscribe((message) => this.onMessage(message));
    }
    if (options.restore === false) {
      if (this.snapshot.status === 'loading') this.setSnapshot('unauthenticated', null);
      return;
    }
    const key = await this.deps.keys.get({ create: false });
    if (!key) {
      // Nessuna chiave = nessuna sessione possibile: niente richiesta di rete inutile.
      if (this.snapshot.status === 'loading') this.setSnapshot('unauthenticated', null);
      return;
    }
    await this.refresh();
  }

  stop(): void {
    this.unsubscribeChannel?.();
    this.unsubscribeChannel = null;
    this.cancelTimer();
  }

  login(email: string, password: string): Promise<void> {
    return this.establish(ADMIN_AUTH_PATHS.login, { email, password });
  }

  /** Rotazione del refresh token. Deduplicata nella scheda, serializzata tra le schede. */
  refresh(): Promise<boolean> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const pending = this.lockedRefresh().finally(() => {
      this.refreshInFlight = null;
    });
    this.refreshInFlight = pending;
    return pending;
  }

  async logout(): Promise<void> {
    this.generation += 1;
    this.cancelTimer();
    this.deps.tokens.clear();
    await this.deps.lock(REFRESH_LOCK_NAME, async () => {
      this.deps.keys.forgetCached();
      const key = await this.deps.keys.get({ create: false });
      if (key) {
        try {
          await this.deps.fetcher({
            method: 'POST',
            path: ADMIN_AUTH_PATHS.logout,
            dpopKey: key,
            withCredentials: true,
          });
        } catch {
          // Anche se il server non è raggiungibile, eliminando la chiave il cookie di refresh
          // (legato al suo jkt) diventa inutilizzabile.
        }
      }
      await this.deps.keys.discard();
    });
    this.deps.channel?.post('logout');
    this.setSnapshot('unauthenticated', null);
  }

  /** Richiesta a una risorsa protetta: `Authorization: DPoP` + prova con `ath`; 1 retry dopo refresh su 401. */
  async authorizedFetch<T>(request: {
    method: 'GET' | 'POST';
    path: string;
    body?: unknown;
  }): Promise<ApiResponse<T>> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let token = this.deps.tokens.get();
      if (token === null) {
        await this.refresh();
        token = this.deps.tokens.get();
        if (token === null) throw new ApiError('http', 401);
      }
      const key = await this.deps.keys.get({ create: false });
      if (!key) {
        this.becomeUnauthenticated('expired');
        throw new ApiError('http', 401);
      }
      try {
        return await this.deps.fetcher<T>({ ...request, dpopKey: key, accessToken: token });
      } catch (error) {
        if (!isUnauthorized(error)) throw error;
        this.deps.tokens.clear();
        if (attempt === 1) {
          this.becomeUnauthenticated('expired');
          throw error;
        }
      }
    }
    throw new ApiError('http', 401);
  }

  // --- interni --------------------------------------------------------------------------------

  private async establish(path: string, body: Record<string, string>): Promise<void> {
    const generation = this.generation;
    await this.deps.lock(REFRESH_LOCK_NAME, async () => {
      // IndexedDB è la fonte di verità condivisa: rilettura sotto lock (un'altra scheda può averla cambiata).
      this.deps.keys.forgetCached();
      const existing = await this.deps.keys.get({ create: false });
      const key = existing ?? (await this.deps.keys.get({ create: true }));
      if (!key) throw new Error('DPoP key unavailable');
      let response: ApiResponse<TokenResponse>;
      try {
        response = await this.deps.fetcher<TokenResponse>({
          method: 'POST',
          path,
          body,
          dpopKey: key,
          withCredentials: true,
        });
      } catch (error) {
        // Chiave appena creata per un tentativo fallito: non lasciarla persistita (eviterebbe al
        // prossimo avvio un refresh destinato a fallire).
        if (!existing) await this.deps.keys.discard();
        throw error;
      }
      if (generation !== this.generation) return;
      this.accept(response.data);
    });
    this.deps.channel?.post('login');
  }

  private lockedRefresh(): Promise<boolean> {
    const generation = this.generation;
    return this.deps.lock(REFRESH_LOCK_NAME, async () => {
      if (generation !== this.generation) return false;
      this.deps.keys.forgetCached();
      const key = await this.deps.keys.get({ create: false });
      if (!key) {
        this.becomeUnauthenticated(this.snapshot.status === 'authenticated' ? 'expired' : null);
        return false;
      }
      try {
        const response = await this.deps.fetcher<TokenResponse>({
          method: 'POST',
          path: ADMIN_AUTH_PATHS.refresh,
          dpopKey: key,
          withCredentials: true,
        });
        if (generation !== this.generation) return false;
        this.accept(response.data);
        return true;
      } catch (error) {
        if (isUnauthorized(error)) {
          // Cookie assente/scaduto/revocato o legato a un'altra chiave: la chiave non serve più.
          const wasAuthenticated = this.snapshot.status === 'authenticated';
          await this.deps.keys.discard();
          this.becomeUnauthenticated(wasAuthenticated ? 'expired' : null);
          return false;
        }
        if (this.deps.tokens.get() !== null) {
          // Errore transitorio (rete, 429, 5xx) con token ancora valido: nuovo tentativo più tardi.
          this.scheduleIn(30_000);
          return true;
        }
        this.becomeUnauthenticated('unavailable');
        return false;
      }
    });
  }

  private accept(data: TokenResponse | null): void {
    if (
      !data ||
      typeof data.access_token !== 'string' ||
      data.token_type !== 'DPoP' ||
      typeof data.expires_in !== 'number'
    ) {
      throw new ApiError('invalid-response', 200);
    }
    this.deps.tokens.set(data.access_token, data.expires_in);
    const expiresAt = this.deps.tokens.expiresAt() ?? this.now();
    this.scheduleIn(expiresAt - this.now() - REFRESH_LEEWAY_SECONDS * 1000);
    this.setSnapshot('authenticated', null);
  }

  private scheduleIn(delayMs: number): void {
    this.cancelTimer();
    this.timer = this.timers.set(
      () => {
        this.timer = null;
        void this.refresh();
      },
      Math.max(5_000, delayMs),
    );
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }

  private becomeUnauthenticated(notice: SessionNotice): void {
    this.deps.tokens.clear();
    this.cancelTimer();
    this.setSnapshot('unauthenticated', notice);
  }

  private onMessage(message: AuthMessage): void {
    if (message === 'logout') {
      this.generation += 1;
      this.deps.keys.forgetCached();
      this.becomeUnauthenticated(null);
      return;
    }
    // Login in un'altra scheda: allinea questa scheda alla nuova sessione (rotazione sotto lock).
    this.deps.keys.forgetCached();
    void this.refresh();
  }

  private setSnapshot(status: SessionStatus, notice: SessionNotice): void {
    if (this.snapshot.status === status && this.snapshot.notice === notice) return;
    this.snapshot = { status, notice };
    for (const listener of this.listeners) listener();
  }

  /** Per il controllo "token in scadenza" al ritorno in primo piano della scheda. */
  needsEarlyRefresh(): boolean {
    const expiresAt = this.deps.tokens.expiresAt();
    return (
      this.snapshot.status === 'authenticated' &&
      expiresAt !== null &&
      expiresAt - this.now() < REFRESH_LEEWAY_SECONDS * 1000
    );
  }
}

export function createBroadcastChannel(name: string = AUTH_CHANNEL_NAME): AuthChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const channel = new BroadcastChannel(name);
  return {
    post: (message) => channel.postMessage(message),
    subscribe: (handler) => {
      const listener = (event: MessageEvent<unknown>) => {
        if (event.data === 'login' || event.data === 'logout') handler(event.data);
      };
      channel.addEventListener('message', listener);
      return () => channel.removeEventListener('message', listener);
    },
  };
}
