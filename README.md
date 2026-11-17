# NZT_WEBSITE
CREAZIONE DEL SITO WEB DI NZT SOLUTIONS

## Documentazione

I documenti di architettura sono in `docs/`:

| Documento | Contenuto |
| --- | --- |
| `docs/architettura_tecnica_nzt_solutions.md` | Stack, struttura del progetto, isole, SEO |
| `docs/architettura_grafica_nzt_solutions_v1_0.md` | Design system e linee guida grafiche |
| `docs/architettura_sicurezza_nzt_solutions.md` | **Regole di sicurezza vincolanti**, stato di applicazione, checklist operativa, registro delle modifiche |

Ogni modifica che tocca la sicurezza va riportata nel documento di sicurezza (sezione interessata,
tabella di stato, registro delle modifiche).

## Sviluppo e verifiche

```bash
pnpm install
pnpm dev          # server di sviluppo (http://localhost:4321)
pnpm lint
pnpm build        # controllo dei tipi + build + hash per la Content Security Policy
pnpm test         # test di sicurezza (quelli di integrazione richiedono il build)
pnpm serve        # server di produzione in locale (node server/index.mjs)
```

## Deploy su Railway

Le pagine sono statiche (prerender); il server Node le serve e gestisce l'unica rotta dinamica,
`POST /api/contact`. Railway costruisce l'immagine dal `Dockerfile` (vedi `railway.json`) e avvia
`node server/index.mjs`: è il perimetro di sicurezza che avvolge il server di Astro (header di sicurezza,
verifica dell'origine, limiti su metodi e corpo). Non avviare direttamente `dist/server/entry.mjs`.
L'healthcheck è `GET /healthz`.

Variabili da impostare su Railway (vedi `.env.example`):

| Variabile | Note |
| --- | --- |
| `PUBLIC_TURNSTILE_SITE_KEY` | Chiave pubblica Cloudflare Turnstile. Serve **al build**: dopo una modifica va rifatto il deploy |
| `TURNSTILE_SECRET_KEY` | Chiave segreta Turnstile. Senza, in produzione il modulo non accetta invii |
| `TURNSTILE_ALLOWED_HOSTNAMES` | Raccomandata: `nztsolutions.it,www.nztsolutions.it` |
| `RESEND_API_KEY` | Senza, il modulo propone l'email precompilata |
| `CONTACT_TO_EMAIL` | Destinatario delle richieste (default `info@nztsolutions.it`) |
| `CONTACT_FROM_EMAIL` | Mittente, su un dominio verificato in Resend |
| `ORIGIN_VERIFY_SECRET` | 64 caratteri esadecimali (`openssl rand -hex 32`). Se impostata, il sito risponde solo alle richieste che arrivano da Cloudflare con l'header `X-Origin-Verify`: va attivata **dopo** aver creato la regola su Cloudflare |

Protezione del modulo contatti: Cloudflare Turnstile + campo honeypot + rate limit (5 invii ogni
10 minuti per client, 30 email l'ora in totale, in memoria: una sola istanza). Le azioni da completare
su Cloudflare, Railway, DNS e GitHub sono elencate nella checklist del documento di sicurezza (§11).

## Area Clienti e stack di prova in Docker

Il repo è un workspace pnpm: la Home è nella radice, l'Area Clienti è in `apps/portal` (frontend), `apps/api` (backend FastAPI) e `packages/ui` (design system condiviso). Il pulsante "Area Clienti" della Home porta a `/accedi` del portale (URL configurabile con `PUBLIC_CLIENT_AREA_URL` in build).

Un solo comando builda e avvia tutto (PostgreSQL, Redis, migrazioni, API, portale, Home):

```bash
docker compose up --build
```

- Home: http://localhost:4321 · Portale: http://localhost:8080 · API: http://localhost:8000/docs
- Le email di verifica sono nei log: `docker compose logs -f api`. Google OAuth non è configurato. Chiavi Turnstile di test.
- Reset dei dati: `docker compose down -v`. Credenziali solo di prova.
- Il vecchio compose di sviluppo della Home è `docker-compose.dev.yml`.
- Script utili: `pnpm dev:portal`, `pnpm build:portal`, `pnpm test:portal`.
