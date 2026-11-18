// src/lib/turnstile.ts — verifica lato server dei token Cloudflare Turnstile.
// Doc: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
// L'URL di destinazione è una costante: nessun input dell'utente può cambiare l'host chiamato (anti-SSRF).
import { z } from '@/lib/zod';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Azione dichiarata dal widget del modulo contatti: un token emesso per un'altra azione non vale qui */
export const TURNSTILE_CONTACT_ACTION = 'contact';

/** La risposta di un servizio esterno si valida come qualsiasi altro input non fidato */
const siteverifySchema = z.object({
  success: z.boolean(),
  'error-codes': z.array(z.string().max(100)).max(20).optional(),
  action: z.string().max(100).optional(),
  hostname: z.string().max(255).optional(),
});

export interface TurnstileOptions {
  /** IP del client, inoltrato a Cloudflare come segnale aggiuntivo */
  remoteIp?: string;
  expectedAction?: string;
  /**
   * Se indicato, il token deve essere stato emesso su uno di questi hostname
   * (un token ottenuto su un altro sito con la stessa chiave non vale).
   */
  allowedHostnames?: readonly string[];
  /** Sostituibile nei test */
  fetchImpl?: typeof fetch;
}

export type TurnstileResult = { ok: true } | { ok: false; reason: string };

export async function verifyTurnstile(
  token: string,
  secret: string,
  {
    remoteIp,
    expectedAction = TURNSTILE_CONTACT_ACTION,
    allowedHostnames,
    fetchImpl = fetch,
  }: TurnstileOptions = {},
): Promise<TurnstileResult> {
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);

  try {
    const res = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, reason: `siteverify HTTP ${res.status}` };

    const parsed = siteverifySchema.safeParse(await res.json());
    if (!parsed.success) return { ok: false, reason: 'siteverify: risposta non valida' };
    const data = parsed.data;

    if (!data.success) {
      return { ok: false, reason: (data['error-codes'] ?? []).join(',') || 'unknown' };
    }
    // Le chiavi di test di Cloudflare non restituiscono l'azione: la controlliamo solo se presente
    if (data.action && data.action !== expectedAction) {
      return { ok: false, reason: 'action mismatch' };
    }
    if (allowedHostnames && allowedHostnames.length > 0) {
      const hostname = data.hostname?.toLowerCase();
      if (!hostname || !allowedHostnames.includes(hostname)) {
        return { ok: false, reason: 'hostname mismatch' };
      }
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.name : 'siteverify error' };
  }
}
