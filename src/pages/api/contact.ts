// src/pages/api/contact.ts — invio del modulo contatti.
// Gira sul server Node (Railway), non è prerenderizzato. Qui c'è solo il collegamento tra la rotta Astro,
// la configurazione e le dipendenze reali: i controlli di sicurezza sono in src/lib/contact-handler.ts.
import type { APIRoute } from 'astro';
import {
  CONTACT_FROM_EMAIL,
  CONTACT_TO_EMAIL,
  RESEND_API_KEY,
  TURNSTILE_ALLOWED_HOSTNAMES,
  TURNSTILE_SECRET_KEY,
} from 'astro:env/server';
import { log } from '@server/logger.mjs';
import { getRequestContext } from '@server/request-context.mjs';
import { createContactHandler } from '@/lib/contact-handler';
import { sendEmail } from '@/lib/email';
import { createRateLimiter } from '@/lib/security/rate-limit';
import { verifyTurnstile } from '@/lib/turnstile';

export type { ContactErrorCode, ContactResponse } from '@/lib/contact-handler';

export const prerender = false;

const handleContact = createContactHandler({
  env: {
    turnstileSecret: TURNSTILE_SECRET_KEY,
    turnstileAllowedHostnames: (TURNSTILE_ALLOWED_HOSTNAMES ?? '')
      .split(',')
      .map((hostname) => hostname.trim().toLowerCase())
      .filter(Boolean),
    resendApiKey: RESEND_API_KEY,
    toEmail: CONTACT_TO_EMAIL,
    fromEmail: CONTACT_FROM_EMAIL,
    production: import.meta.env.PROD,
  },
  // 5 invii ogni 10 minuti per client; 30 email l'ora in totale
  ipLimiter: createRateLimiter({ limit: 5, windowMs: 10 * 60 * 1000 }),
  globalLimiter: createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000, maxKeys: 1 }),
  verifyCaptcha: verifyTurnstile,
  sendEmail,
  log,
});

export const POST: APIRoute = ({ request, clientAddress }) => {
  // In produzione l'IP arriva dal perimetro (server/index.mjs), che lo ricava solo da proxy verificati.
  // Con `astro dev` il perimetro non c'è: si usa l'indirizzo della connessione.
  const context = getRequestContext();
  let ip = context?.clientIp;
  if (!ip) {
    try {
      ip = clientAddress;
    } catch {
      ip = 'unknown';
    }
  }
  return handleContact(request, { ip, requestId: context?.requestId });
};

// Qualsiasi altro metodo
export const ALL: APIRoute = () => new Response(null, { status: 405, headers: { Allow: 'POST' } });
