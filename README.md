# NZT_WEBSITE
CREAZIONE DEL SITO WEB DI NZT SOLUTIONS

## Deploy su Railway

Le pagine sono statiche (prerender); il server Node (`@astrojs/node`, standalone) le serve e gestisce
l'unica rotta dinamica, `POST /api/contact`. Build e avvio sono definiti in `railway.json`.

Variabili da impostare su Railway (vedi `.env.example`):

| Variabile | Note |
| --- | --- |
| `PUBLIC_TURNSTILE_SITE_KEY` | Chiave pubblica Cloudflare Turnstile. Serve **al build**: dopo una modifica va rifatto il deploy |
| `TURNSTILE_SECRET_KEY` | Chiave segreta Turnstile. Senza, in produzione il modulo non accetta invii |
| `RESEND_API_KEY` | Senza, il modulo propone l'email precompilata |
| `CONTACT_TO_EMAIL` | Destinatario delle richieste (default `info@nztsolutions.it`) |
| `CONTACT_FROM_EMAIL` | Mittente, su un dominio verificato in Resend |

Protezione anti-bot del modulo contatti: Cloudflare Turnstile + campo honeypot + rate limit per IP
(5 invii ogni 10 minuti, in memoria). Per bloccare il traffico automatizzato sull'intero sito conviene
inoltre proxare il dominio tramite Cloudflare (Bot Fight Mode, WAF, regole di rate limiting).
