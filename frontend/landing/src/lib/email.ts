// src/lib/email.ts — invio email transazionale tramite l'API REST di Resend.
// Chiamata diretta con fetch, senza SDK: una sola richiesta HTTPS verso un host costante, e nessuna
// dipendenza aggiuntiva (con le sue dipendenze transitive) da tenere aggiornata.
// Doc: https://resend.com/docs/api-reference/emails/send-email
import { z } from '@/lib/zod';

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';

export interface OutgoingEmail {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  /** Solo testo semplice: i dati inseriti dall'utente non vengono mai interpretati come HTML */
  text: string;
}

export type EmailResult = { ok: true } | { ok: false; status: number | null; reason: string };

const errorSchema = z.object({ name: z.string().max(100) });

export async function sendEmail(
  apiKey: string,
  email: OutgoingEmail,
  fetchImpl: typeof fetch = fetch,
): Promise<EmailResult> {
  try {
    const res = await fetchImpl(RESEND_EMAILS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: email.from,
        to: [email.to],
        reply_to: email.replyTo,
        subject: email.subject,
        text: email.text,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: true };
    }

    // Dal corpo dell'errore si conserva solo il nome dell'errore, mai il messaggio (può citare i dati inviati)
    const parsed = errorSchema.safeParse(await res.json().catch(() => null));
    return { ok: false, status: res.status, reason: parsed.success ? parsed.data.name : 'unknown' };
  } catch (error) {
    return {
      ok: false,
      status: null,
      reason: error instanceof Error ? error.name : 'network_error',
    };
  }
}
