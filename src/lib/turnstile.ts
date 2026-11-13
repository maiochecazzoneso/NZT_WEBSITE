// src/lib/turnstile.ts — verifica lato server dei token Cloudflare Turnstile.
// Doc: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Azione dichiarata dal widget del modulo contatti: un token emesso per un'altra azione non vale qui */
export const TURNSTILE_CONTACT_ACTION = 'contact';

interface SiteverifyResponse {
  success: boolean;
  'error-codes'?: string[];
  action?: string;
  hostname?: string;
}

export async function verifyTurnstile(
  token: string,
  secret: string,
  remoteIp?: string,
  expectedAction = TURNSTILE_CONTACT_ACTION,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, reason: `siteverify HTTP ${res.status}` };
    const data = (await res.json()) as SiteverifyResponse;
    if (!data.success) {
      return { ok: false, reason: (data['error-codes'] ?? []).join(',') || 'unknown' };
    }
    // Le chiavi di test di Cloudflare non restituiscono l'azione: la controlliamo solo se presente
    if (data.action && data.action !== expectedAction) {
      return { ok: false, reason: `action mismatch (${data.action})` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'siteverify error' };
  }
}
