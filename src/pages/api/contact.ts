// src/pages/api/contact.ts — invio del modulo contatti (Step 6).
// Gira sul server Node (Railway), non è prerenderizzato. Ordine dei controlli, dal più economico:
// rate limit per IP → validazione Zod → honeypot → Cloudflare Turnstile → invio email con Resend.
import type { APIRoute } from 'astro';
import { Resend } from 'resend';
import {
  CONTACT_FROM_EMAIL,
  CONTACT_TO_EMAIL,
  RESEND_API_KEY,
  TURNSTILE_SECRET_KEY,
} from 'astro:env/server';
import { contactRequestSchema, serviceLabel } from '@/lib/contact-schema';
import { verifyTurnstile } from '@/lib/turnstile';

export const prerender = false;

export type ContactErrorCode =
  | 'invalid'
  | 'captcha'
  | 'rate_limited'
  | 'unavailable'
  | 'send_failed';

export type ContactResponse = { ok: true } | { ok: false; error: ContactErrorCode };

const json = (body: ContactResponse, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });

// Rate limit in memoria: basta per una singola istanza Railway. Con più repliche servirebbe uno store
// condiviso (Redis) oppure una regola di Rate Limiting su Cloudflare davanti al dominio.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= WINDOW_MS)) hits.delete(key);
    }
  }
  return recent.length > MAX_PER_WINDOW;
}

function clientIp(request: Request, fallback: string): string {
  // Cloudflare (se il dominio è proxato) → edge Railway → connessione diretta
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip') ??
    forwarded ??
    fallback
  );
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ ok: false, error: 'invalid' }, 415);
  }

  let ip = 'unknown';
  try {
    ip = clientIp(request, clientAddress);
  } catch {
    // clientAddress non disponibile: si va avanti senza IP
  }

  if (isRateLimited(ip)) {
    return json({ ok: false, error: 'rate_limited' }, 429, { 'Retry-After': '600' });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid' }, 400);
  }

  const parsed = contactRequestSchema.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: 'invalid' }, 400);
  const { turnstileToken, website, ...values } = parsed.data;

  // Honeypot compilato: è un bot. Risposta di successo apparente, così non impara nulla.
  if (website) return json({ ok: true }, 200);

  if (TURNSTILE_SECRET_KEY) {
    if (!turnstileToken) return json({ ok: false, error: 'captcha' }, 400);
    const result = await verifyTurnstile(turnstileToken, TURNSTILE_SECRET_KEY, ip);
    if (!result.ok) {
      console.warn(`[contact] Turnstile rifiutato (${ip}): ${result.reason}`);
      return json({ ok: false, error: 'captcha' }, 400);
    }
  } else if (import.meta.env.PROD) {
    // In produzione senza captcha configurato non si accettano invii: meglio il fallback email del client
    console.error('[contact] TURNSTILE_SECRET_KEY mancante: invio disabilitato');
    return json({ ok: false, error: 'unavailable' }, 503);
  } else {
    console.warn('[contact] TURNSTILE_SECRET_KEY mancante: verifica captcha saltata (solo sviluppo)');
  }

  if (!RESEND_API_KEY) {
    console.error('[contact] RESEND_API_KEY mancante: invio disabilitato');
    return json({ ok: false, error: 'unavailable' }, 503);
  }

  const label = serviceLabel(values.service);
  const text = [
    `Nome e cognome: ${values.name}`,
    `Email: ${values.email}`,
    `Azienda / Studio: ${values.company}`,
    values.phone ? `Telefono: ${values.phone}` : null,
    `Su cosa intervenire: ${label}`,
    '',
    values.message || '(nessun messaggio)',
  ]
    .filter((line) => line !== null)
    .join('\n');

  const resend = new Resend(RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: CONTACT_FROM_EMAIL,
    to: CONTACT_TO_EMAIL,
    replyTo: values.email,
    subject: `Richiesta dal sito — ${label} — ${values.company}`.replace(/[\r\n]+/g, ' '),
    text,
  });

  if (error) {
    console.error('[contact] Resend:', error.name, error.message);
    return json({ ok: false, error: 'send_failed' }, 502);
  }

  return json({ ok: true }, 200);
};

// Qualsiasi altro metodo
export const ALL: APIRoute = () =>
  new Response(null, { status: 405, headers: { Allow: 'POST' } });
