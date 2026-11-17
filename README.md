# NZT Solutions

Monorepo pnpm (workspaces) del progetto NZT Solutions.

## Struttura

```
.
├── apps/
│   ├── landing/   Sito pubblico (Astro 5, React, Tailwind 4)
│   ├── portal/    Area Clienti (frontend) - in arrivo
│   └── api/       Backend FastAPI (Python) - in arrivo
├── packages/
│   └── ui/        Design system condiviso - in arrivo
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

In arrivo.

## API (`apps/api`)

In arrivo.

## Documentazione

La documentazione (architettura grafica e tecnica, specifiche della hero e dell'Area Clienti) è in `docs/`.
