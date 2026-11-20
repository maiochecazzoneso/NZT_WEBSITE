# Ambiente Railway e Cloudflare Pages (`test` e `production`)

Progetto Railway `hospitable-consideration`, ambiente `test` (separato da `production`, che segue `main`).

## Architettura ottimizzata per minimo consumo su Railway

Per ridurre al minimo il consumo computazionale su Railway (RAM, vCPU, egress) senza compromettere sicurezza o funzionalità:

| Componente | Dove gira | Note |
|---|---|---|
| **Landing (`nztsolutions.it`)** | **Cloudflare Pages** (Free, \$0/mese) + Pages Function `POST /api/contact` | Build `pnpm --filter nzt-solutions-web build`, output `frontend/landing/dist/client` (include `_headers` con hash CSP SHA-256 generati al build) + `frontend/landing/functions/api/contact.ts` con `nodejs_compat`. In alternativa: container Node `frontend/landing/Dockerfile` su Railway. |
| **Portal (`clienti.nztsolutions.it`) & Admin (`admin.nztsolutions.it`)** | **Cloudflare Pages** (Free, \$0/mese) — oppure container unico Caddy `frontend/deploy/web.Dockerfile` | Su Cloudflare Pages: due progetti collegati a `frontend/portal/dist` e `frontend/admin/dist` (con `deploy/_headers` e `deploy/_redirects` già inclusi in `public/` o copiati al build). Su Railway: un solo Caddy non-root (`PORT=8080`, `API_ORIGIN`, `ADMIN_HOST`, pre-compressione zstd/gzip, `healthcheckPath: /healthz`). |
| **API (`api.nztsolutions.it`)** | **Railway** (`backend/Dockerfile`, ~75–90 MiB RSS) | FastAPI + Uvicorn `--no-proxy-headers --no-server-header --workers 1`, SigV4 stdlib senza `boto3`, `MALLOC_ARENA_MAX=2`, pool MongoDB `maxPoolSize=5`, `ARGON2_MAX_CONCURRENCY=1`. |
| **Redis** | **Railway** (template Redis 7, rete privata) | `redis.railway.internal`, volume < 0,5 GB, **sempre attivo** (no App Sleeping: `socket_connect_timeout=5s`, altrimenti fail-closed `503`). |
| **MongoDB** | **Esterno** (cluster condiviso, database `nzt`) | `NZT_MONGODB_URI` (utente `nzt_app`, `downloadLogs` insert-only) e `NZT_MONGODB_DATABASE`. |

### Avvertenze critiche per test e produzione

1. **Mai usare `*.up.railway.app` per `api` + `web` con `SameSite=Strict`:** `up.railway.app` è nella Public Suffix List; `web-test.up.railway.app` e `api-test.up.railway.app` sono **cross-site** e i browser scartano i cookie di refresh e OAuth. Usare sempre sottodomini dello stesso dominio (es. `clienti-test.nztsolutions.it`, `admin-test.nztsolutions.it`, `api-test.nztsolutions.it`).
2. **MongoDB Atlas IP Access List vs Piano Railway:** l'allowlist statica degli IP di uscita di Railway richiede gli **Static Outbound IPs** (piano **Railway Pro**); i piani Free/Hobby usano IP di uscita dinamici.
3. **App Sleeping su `api`:** i battiti SDAM di PyMongo ogni 10s verso MongoDB mantengono `api` attivo (e un cold start sotto carico rischierebbe di superare i 15s del timeout client). Tenere `api` e `redis` sempre attivi; i frontend su Cloudflare Pages hanno già costo \$0 e zero cold start.
4. **Cloudflare Scrape Shield / Speed:** su `nztsolutions.it` disattivare **Email Address Obfuscation**, **Rocket Loader**, **Auto Minify** e **Web Analytics** automatici, altrimenti alterano gli script inline invalidando gli hash SHA-256 della CSP.
5. **Utenti di prova:** NON creati di default (`seed_dev_users.py` escluso dall'immagine di produzione). Per crearli in locale usare `docker compose up --build` (`127.0.0.1:4321`, `8080`, `8081`, `8000`).
