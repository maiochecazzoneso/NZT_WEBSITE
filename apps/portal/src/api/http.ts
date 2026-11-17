// Client HTTP verso l'API: aggiunge la prova DPoP (e `Authorization: DPoP <token>` + `ath` sulle
// risorse protette), normalizza gli errori in ApiError. Non logga mai richieste, token o corpi.

import { API_BASE_URL, REQUEST_TIMEOUT_MS } from '../config';
import { createDpopProof, type DpopKey } from '../auth/dpop';

export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'invalid-response';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  /** `detail` testuale del backend: usato SOLO per classificare, mai mostrato all'utente. */
  readonly detail: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    kind: ApiErrorKind,
    status = 0,
    detail: string | null = null,
    retryAfterSeconds: number | null = null,
  ) {
    super(kind === 'http' ? `HTTP ${status}` : kind);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.detail = detail;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Retry-After: secondi interi o HTTP-date (RFC 9110 §10.2.3). Null se assente/illeggibile. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

export interface ApiRequest {
  method: 'GET' | 'POST';
  /** Path assoluto dell'API, es. /api/v1/auth/login (mai query string con dati sensibili). */
  path: string;
  body?: unknown;
  dpopKey?: DpopKey;
  accessToken?: string;
  /** true per gli endpoint /api/v1/auth/* che leggono/scrivono i cookie HttpOnly. */
  withCredentials?: boolean;
}

export interface ApiResponse<T> {
  status: number;
  data: T | null;
}

export type ApiFetcher = <T>(request: ApiRequest) => Promise<ApiResponse<T>>;

export function apiUrl(path: string): string {
  if (!path.startsWith('/api/')) throw new Error('API path must start with /api/');
  return `${API_BASE_URL}${path}`;
}

export const apiFetch: ApiFetcher = async <T>(request: ApiRequest): Promise<ApiResponse<T>> => {
  const url = apiUrl(request.path);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (request.body !== undefined) headers['Content-Type'] = 'application/json';
  if (request.dpopKey) {
    headers.DPoP = await createDpopProof(request.dpopKey, {
      method: request.method,
      url,
      ...(request.accessToken !== undefined ? { accessToken: request.accessToken } : {}),
    });
  }
  if (request.accessToken !== undefined) headers.Authorization = `DPoP ${request.accessToken}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: request.method,
      headers,
      body: request.body === undefined ? null : JSON.stringify(request.body),
      mode: 'cors',
      credentials: request.withCredentials ? 'include' : 'omit',
      // keepalive sulle richieste che ruotano/impostano il cookie di refresh: se la pagina viene
      // chiusa o ricaricata a metà richiesta, il browser completa comunque la richiesta e salva il
      // nuovo cookie, invece di perderlo (cosa che al refresh successivo presenterebbe il cookie già
      // consumato e farebbe scattare la reuse detection, revocando tutte le sessioni).
      keepalive: request.withCredentials === true,
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(controller.signal.aborted ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) return { status: 204, data: null };

  let payload: unknown = null;
  const contentType = response.headers.get('Content-Type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      payload = await response.json();
    } catch {
      if (response.ok) throw new ApiError('invalid-response', response.status);
    }
  }

  if (!response.ok) {
    const detail =
      typeof payload === 'object' &&
      payload !== null &&
      typeof (payload as { detail?: unknown }).detail === 'string'
        ? (payload as { detail: string }).detail
        : null;
    // Retry-After cross-origin è leggibile perché il backend lo espone (Access-Control-Expose-
    // Headers: Retry-After, anche su 413/429/5xx). Se manca o è illeggibile vale null e la UI
    // mostra un messaggio generico.
    throw new ApiError(
      'http',
      response.status,
      detail,
      parseRetryAfter(response.headers.get('Retry-After')),
    );
  }
  return { status: response.status, data: payload as T };
};
