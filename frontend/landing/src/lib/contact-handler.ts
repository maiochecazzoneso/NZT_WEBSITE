// src/lib/contact-handler.ts — logica di POST /api/contact, separata dalla rotta Astro per poterla
// collaudare con dipendenze sostituite (vedi tests/contact-handler.test.ts).
// Ordine dei controlli, dal più economico al più costoso, ciascuno con il proprio evento di audit:
//   Content-Type → stessa origine → rate limit per IP → corpo (dimensione, JSON) → schema Zod strict →
//   honeypot → Cloudflare Turnstile → tetto globale di invii → invio email
// Riferimento: docs/architettura_sicurezza_nzt_solutions.md §3 e §8
import { anonymizeIp, rateLimitKey } from '@server/client-ip.mjs';
import { MAX_BODY_BYTES } from '@server/config.mjs';
import type { LogFunction } from '@server/logger.mjs';
import { contactRequestSchema, serviceLabel } from '@/lib/contact-schema';
import type { EmailResult, OutgoingEmail } from '@/lib/email';
import type { RateLimiter } from '@/lib/security/rate-limit';
import {
  isJsonContentType,
  isSameOriginRequest,
  readJsonBody,
} from '@/lib/security/request-guards';
import type { TurnstileOptions, TurnstileResult } from '@/lib/turnstile';

export type ContactErrorCode =
  'invalid' | 'forbidden' | 'captcha' | 'rate_limited' | 'unavailable' | 'send_failed';

export type ContactResponse = { ok: true } | { ok: false; error: ContactErrorCode };

export interface ContactEnv {
  turnstileSecret: string | undefined;
  /** Hostname su cui il token Turnstile deve essere stato emesso (vuoto = nessun vincolo) */
  turnstileAllowedHostnames: readonly string[];
  resendApiKey: string | undefined;
  toEmail: string;
  fromEmail: string;
  production: boolean;
}

export interface ContactClient {
  /** IP risolto da una fonte fidata (server/client-ip.mjs) */
  ip: string;
  requestId: string | undefined;
}

export interface ContactDeps {
  env: ContactEnv;
  /** Limite per singolo client */
  ipLimiter: RateLimiter;
  /** Tetto complessivo di email inviate: argina un attacco distribuito che supera il captcha */
  globalLimiter: RateLimiter;
  verifyCaptcha: (
    token: string,
    secret: string,
    options: TurnstileOptions,
  ) => Promise<TurnstileResult>;
  sendEmail: (apiKey: string, email: OutgoingEmail) => Promise<EmailResult>;
  log: LogFunction;
}

const json = (body: ContactResponse, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });

export function createContactHandler({
  env,
  ipLimiter,
  globalLimiter,
  verifyCaptcha,
  sendEmail,
  log,
}: ContactDeps) {
  return async function handleContact(request: Request, client: ContactClient): Promise<Response> {
    // Nei log: id della richiesta e IP troncato. Mai nome, email, azienda o testo del messaggio.
    const audit = { requestId: client.requestId, ip: anonymizeIp(client.ip) };

    if (!isJsonContentType(request)) {
      log('warn', 'contact_unsupported_media_type', audit);
      return json({ ok: false, error: 'invalid' }, 415);
    }

    if (!isSameOriginRequest(request)) {
      log('warn', 'contact_forbidden_origin', audit);
      return json({ ok: false, error: 'forbidden' }, 403);
    }

    const ipDecision = ipLimiter.hit(rateLimitKey(client.ip));
    if (ipDecision.limited) {
      log('warn', 'contact_rate_limited', { ...audit, scope: 'ip' });
      return json({ ok: false, error: 'rate_limited' }, 429, {
        'Retry-After': String(ipDecision.retryAfterSeconds),
      });
    }

    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) {
      log('warn', 'contact_invalid_payload', { ...audit, reason: body.reason });
      return json({ ok: false, error: 'invalid' }, body.reason === 'too_large' ? 413 : 400);
    }

    const parsed = contactRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      // Solo i nomi dei campi rifiutati, non i valori
      const fields = [
        ...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? '(root)'))),
      ];
      log('warn', 'contact_invalid_payload', { ...audit, reason: 'schema', fields });
      return json({ ok: false, error: 'invalid' }, 400);
    }
    const { turnstileToken, website, ...values } = parsed.data;

    // Honeypot compilato: è un bot. Risposta di successo apparente, così non impara nulla.
    if (website) {
      log('warn', 'contact_honeypot', audit);
      return json({ ok: true }, 200);
    }

    if (env.turnstileSecret) {
      if (!turnstileToken) {
        log('warn', 'contact_captcha_failed', { ...audit, reason: 'missing' });
        return json({ ok: false, error: 'captcha' }, 400);
      }
      const result = await verifyCaptcha(turnstileToken, env.turnstileSecret, {
        remoteIp: client.ip === 'unknown' ? undefined : client.ip,
        allowedHostnames: env.turnstileAllowedHostnames,
      });
      if (!result.ok) {
        log('warn', 'contact_captcha_failed', { ...audit, reason: result.reason });
        return json({ ok: false, error: 'captcha' }, 400);
      }
    } else if (env.production) {
      // In produzione senza captcha configurato non si accettano invii: meglio il fallback email del client
      log('error', 'contact_unavailable', { ...audit, reason: 'TURNSTILE_SECRET_KEY mancante' });
      return json({ ok: false, error: 'unavailable' }, 503);
    } else {
      log('warn', 'contact_captcha_skipped', { ...audit, reason: 'solo sviluppo' });
    }

    if (!env.resendApiKey) {
      log('error', 'contact_unavailable', { ...audit, reason: 'RESEND_API_KEY mancante' });
      return json({ ok: false, error: 'unavailable' }, 503);
    }

    const globalDecision = globalLimiter.hit('all');
    if (globalDecision.limited) {
      log('error', 'contact_rate_limited', { ...audit, scope: 'global' });
      return json({ ok: false, error: 'rate_limited' }, 429, {
        'Retry-After': String(globalDecision.retryAfterSeconds),
      });
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

    const sent = await sendEmail(env.resendApiKey, {
      from: env.fromEmail,
      to: env.toEmail,
      replyTo: values.email,
      // Lo schema esclude già i caratteri di controllo: la sostituzione resta come seconda barriera
      subject: `Richiesta dal sito — ${label} — ${values.company}`.replace(/[\r\n]+/g, ' '),
      text,
    });

    if (!sent.ok) {
      log('error', 'contact_send_failed', { ...audit, status: sent.status, reason: sent.reason });
      return json({ ok: false, error: 'send_failed' }, 502);
    }

    log('info', 'contact_sent', { ...audit, service: values.service });
    return json({ ok: true }, 200);
  };
}
