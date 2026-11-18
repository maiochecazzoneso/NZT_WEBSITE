# NZT_WEBSITE

Sito web, Area Clienti e API di NZT Solutions.

## Struttura

```text
NZT_WEBSITE/
├── frontend/               tutto ciò che gira nel browser (workspace pnpm)
│   ├── landing/            sito pubblico nztsolutions.it (Astro + server Node di produzione)
│   ├── portal/             Area Clienti (React + Vite)
│   ├── admin/              dashboard amministratore (React + Vite, login separato)
│   ├── ui/                 design system condiviso @nzt/ui
│   └── deploy/             container Caddy unico per portale + dashboard (Railway "web")
├── backend/                API dell'Area Clienti (FastAPI, Python 3.12, uv)
├── database/               strumenti MongoDB: utenti a privilegio minimo, migrazione dati
├── docs/                   architettura tecnica, grafica e di sicurezza; screenshots/
├── docker-compose.yml      stack completo in locale
└── package.json            radice del workspace pnpm (comandi rapidi, Prettier)
```

Ogni cartella ha il proprio `Dockerfile` e la propria configurazione. Lo schema MongoDB (validatori e
indici) è definito nel codice dell'API, in `backend/src/app/schema.py`; vedi `database/README.md`.

## Documentazione

| Documento | Contenuto |
| --- | --- |
| `docs/architettura_tecnica_nzt_solutions.md` | Stack del sito, struttura, isole, SEO |
| `docs/architettura_grafica_nzt_solutions_v1_0.md` | Design system e linee guida grafiche |
| `docs/architettura_sicurezza_nzt_solutions.md` | **Regole di sicurezza vincolanti**, stato di applicazione, checklist operativa, registro delle modifiche |
| `docs/architettura_sicurezza_area_clienti.md` | Sicurezza di Area Clienti, API e database |
| `docs/railway_ambiente_test.md` | Ambiente Railway di test |

Ogni modifica che tocca la sicurezza va riportata nel documento di sicurezza (sezione interessata,
tabella di stato, registro delle modifiche).

## Frontend

Dalla radice (un solo `pnpm install` per tutto il frontend):

```bash
pnpm install
pnpm dev          # sito pubblico (http://localhost:4321)
pnpm lint
pnpm build        # controllo dei tipi + build + hash per la Content Security Policy
pnpm test         # test di sicurezza (quelli di integrazione richiedono il build)
pnpm serve        # server di produzione in locale (node server/index.mjs)
pnpm dev:portal   # Area Clienti        (anche build:portal, test:portal)
pnpm dev:admin    # dashboard admin     (anche build:admin, test:admin)
```

### Deploy del sito su Railway

Le pagine sono statiche (prerender); il server Node le serve e gestisce l'unica rotta dinamica,
`POST /api/contact`. Railway costruisce l'immagine da `frontend/landing/Dockerfile` (contesto: radice
del repository; configurazione in `frontend/landing/railway.json`) e avvia `node server/index.mjs`: è il
perimetro di sicurezza che avvolge il server di Astro (header di sicurezza, verifica dell'origine, limiti
su metodi e corpo). Non avviare direttamente `dist/server/entry.mjs`. L'healthcheck è `GET /healthz`.

Variabili da impostare su Railway (vedi `frontend/landing/.env.example`):

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

Il pulsante "Area Clienti" del sito porta a `/accedi` del portale (URL configurabile con
`PUBLIC_CLIENT_AREA_URL` in build).

## Backend

```bash
cd backend
uv sync
scripts/test-services.sh start   # MongoDB 8 + Redis 7 reali (MONGOD=/percorso/mongod se non nel PATH)
uv run pytest
uv run python -m app.schema      # applica validatori + indici MongoDB (utente di schema)
```

Configurazione: `backend/.env.example`. Deploy: `backend/Dockerfile` + `backend/railway.json`.

## Database

MongoDB esterno (cluster condiviso tra i servizi NZT, un database per servizio). Vedi
`database/README.md`: utenti a privilegio minimo, schema, migrazione dei dati da PostgreSQL.

## Tutto insieme in Docker

Un solo comando builda e avvia tutto (MongoDB, Redis, API con schema all'avvio, portale, dashboard, sito):

```bash
docker compose up --build
```

- Sito: http://localhost:4321 · Portale clienti: http://localhost:8080 · Dashboard admin: http://localhost:8081 · API: http://localhost:8000/docs
- Le email di verifica sono nei log: `docker compose logs -f api`. Google OAuth non è configurato. Chiavi Turnstile di test.
- Utenti di prova (creati all'avvio dell'API, vedi `backend/docker-entrypoint.sh`, solo stack locale):
  - **Admin**: `admin@example.com` / `admin` → dashboard amministratore http://localhost:8081
  - **Cliente**: `cliente@example.com` / `cliente` → Area Clienti http://localhost:8080/accedi
- Reset dei dati: `docker compose down -v`. Credenziali solo di prova.
