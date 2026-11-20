// Cloudflare Pages Function per POST /api/contact (deploy serverless a costo $0 su Cloudflare Pages).
// Riutilizza la stessa logica di validazione/Turnstile/Resend di src/lib/contact-handler.ts.
import { createContactHandler } from '../../src/lib/contact-handler';
import { sendEmail } from '../../src/lib/email';
import { createRateLimiter } from '../../src/lib/security/rate-limit';
import { verifyTurnstile } from '../../src/lib/turnstile';
import { apiSecurityHeaders } from '../../server/security-headers.mjs';

interface Env {
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_ALLOWED_HOSTNAMES?: string;
  RESEND_API_KEY?: string;
  CONTACT_TO_EMAIL?: string;
  CONTACT_FROM_EMAIL?: string;
}

const ipLimiter = createRateLimiter({ limit: 5, windowMs: 10 * 60 * 1000 });
const globalLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000, maxKeys: 1 });

function withApiHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(apiSecurityHeaders())) {
    headers.set(k, v);
  }
  return new Response(response.body, { status: response.status, headers });
}

export const onRequestPost = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;
  const handler = createContactHandler({
    env: {
      turnstileSecret: env.TURNSTILE_SECRET_KEY,
      turnstileAllowedHostnames: (env.TURNSTILE_ALLOWED_HOSTNAMES ?? '')
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean),
      resendApiKey: env.RESEND_API_KEY,
      toEmail: env.CONTACT_TO_EMAIL || 'info@nztsolutions.it',
      fromEmail: env.CONTACT_FROM_EMAIL || 'NZT Solutions <sito@nztsolutions.it>',
      production: true,
    },
    ipLimiter,
    globalLimiter,
    verifyCaptcha: verifyTurnstile,
    sendEmail,
    log: (level, event, fields) => {
      // eslint-disable-next-line no-console
      console[level === 'error' ? 'error' : 'log'](JSON.stringify({ level, event, ...fields }));
    },
  });

  // Su Cloudflare Pages CF-Connecting-IP è sempre impostato dal edge Cloudflare
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const requestId = request.headers.get('cf-ray') ?? undefined;
  return withApiHeaders(await handler(request, { ip, requestId }));
};

export const onRequest = async () =>
  withApiHeaders(new Response(null, { status: 405, headers: { Allow: 'POST' } }));
