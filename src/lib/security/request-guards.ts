// src/lib/security/request-guards.ts — controlli sulla forma di una richiesta API, prima di leggerne i dati.
// Riferimento: docs/architettura_sicurezza_nzt_solutions.md §2.1 e §3.1

/** Content-Type esattamente `application/json` (parametri come `charset` ammessi). */
export function isJsonContentType(request: Request): boolean {
  const mediaType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  return mediaType === 'application/json';
}

const firstHeaderValue = (value: string | null): string | null =>
  value?.split(',')[0]?.trim().toLowerCase() || null;

/**
 * Anti-CSRF: la richiesta deve provenire da una pagina dello stesso sito.
 * - `Sec-Fetch-Site`, se presente, deve valere `same-origin` (lo impostano i browser, non è scrivibile da JS)
 * - `Origin`, se presente, deve avere lo stesso host della richiesta (`Host` / `X-Forwarded-Host`: un
 *   browser vittima non può alterarli)
 * I client non-browser (senza questi header) non sono un vettore CSRF: li fermano captcha e rate limit.
 */
export function isSameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site')?.trim().toLowerCase();
  if (fetchSite && fetchSite !== 'same-origin') return false;

  const origin = request.headers.get('origin');
  if (origin === null) return true;

  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false; // comprende `Origin: null` (iframe sandbox, redirect cross-origin)
  }
  const requestHosts = [
    firstHeaderValue(request.headers.get('host')),
    firstHeaderValue(request.headers.get('x-forwarded-host')),
  ];
  return requestHosts.includes(originHost);
}

export type BodyReadResult =
  { ok: true; value: unknown } | { ok: false; reason: 'too_large' | 'invalid_json' };

/**
 * Legge il corpo come JSON senza mai tenere in memoria più di `maxBytes`: la lettura si interrompe al
 * superamento del limite, anche se `Content-Length` manca o mente (richieste `chunked`).
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<BodyReadResult> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: 'too_large' };
  if (request.body === null) return { ok: false, reason: 'invalid_json' };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: 'too_large' };
      }
      chunks.push(value);
    }
  } catch {
    // Lettura interrotta: connessione chiusa dal client o limite di sicurezza dell'adapter superato
    return { ok: false, reason: 'invalid_json' };
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
}
