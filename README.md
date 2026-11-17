# NZT Solutions

Monorepo pnpm (workspaces) del progetto NZT Solutions.

## Struttura

```
.
├── apps/
│   ├── landing/   Sito pubblico (Astro 5, React, Tailwind 4)
│   ├── portal/    Area Clienti (frontend: React 19, Vite 6, Tailwind 4, DPoP)
│   └── api/       Backend Area Clienti (FastAPI, Python 3.12, PostgreSQL 16, Redis)
├── packages/
│   └── ui/        Design system condiviso @nzt/ui (usato da landing e portale)
├── docs/          Specifiche e documentazione di progetto
├── package.json
└── pnpm-workspace.yaml   (apps/*, packages/*)
```

## Requisiti

- Node.js 22
- pnpm 10.28.0 (versione indicata in `packageManager`; con Corepack: `corepack enable`)

## Installazione

Dalla radice del repository:

```bash
pnpm install
```

## Landing (`apps/landing`)

Dalla radice:

```bash
pnpm dev:landing       # server di sviluppo Astro
pnpm build:landing     # astro check + astro build (output in apps/landing/dist)
pnpm preview:landing   # anteprima della build
```

Lint e formattazione di tutti i workspace:

```bash
pnpm lint
pnpm format
```

Ogni app contiene la propria configurazione ESLint/Prettier/TypeScript.

## Portal (`apps/portal`)

Area Clienti (`clienti.nztsolutions.it`). Dalla radice:

```bash
pnpm dev:portal        # server di sviluppo Vite
pnpm build:portal      # typecheck + vite build (output in apps/portal/dist)
pnpm preview:portal    # anteprima con gli header di produzione (CSP)
pnpm --filter @nzt/portal test   # Vitest
```

Variabili di build: `VITE_API_BASE_URL`, `VITE_OAUTH_AUTHORIZE_ORIGINS`.

## API (`apps/api`)

Backend FastAPI dell'Area Clienti (`api.nztsolutions.it`). Da `apps/api`:

```bash
uv sync --frozen
scripts/test-services.sh start      # PostgreSQL 16 + Redis di test (oppure docker-compose.test.yml)
uv run pytest -q                    # suite contro PostgreSQL e Redis reali
uv run ruff check . && uv run ruff format --check . && uv run mypy
```

Configurazione: variabili `NZT_*` (modello in `apps/api/.env.example`). Architettura e runbook di sicurezza: `docs/architettura_sicurezza_area_clienti.md`.

## Documentazione

La documentazione (architettura grafica e tecnica, specifiche della hero e dell'Area Clienti) è in `docs/`.
