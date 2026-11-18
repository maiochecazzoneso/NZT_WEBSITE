# syntax=docker/dockerfile:1
# Immagine di produzione del sito (Railway). Multi-stage, utente non privilegiato, nessuna dipendenza npm a runtime.
# Riferimento: docs/architettura_sicurezza_nzt_solutions.md §6
# L'immagine base è fissata per digest: la aggiorna Dependabot (.github/dependabot.yml).

# ----------------- Build Stage -----------------
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS builder

ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

WORKDIR /app

# pnpm nella versione dichiarata in package.json ("packageManager")
RUN corepack enable

# Monorepo (contesto di build: radice del repository). Il lockfile contiene anche portale, dashboard e
# design system, quindi servono i loro package.json.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/landing/package.json frontend/landing/
COPY frontend/portal/package.json frontend/portal/
COPY frontend/admin/package.json frontend/admin/
COPY frontend/ui/package.json frontend/ui/
RUN pnpm install --frozen-lockfile --filter nzt-solutions-web...

COPY . .

# Unica variabile necessaria al build: è pubblica per natura (finisce nel bundle del browser).
# I segreti (TURNSTILE_SECRET_KEY, RESEND_API_KEY, ORIGIN_VERIFY_SECRET) NON vanno dichiarati qui:
# resterebbero nei layer dell'immagine. Si leggono solo a runtime dalle Variables di Railway.
ARG PUBLIC_TURNSTILE_SITE_KEY
ENV PUBLIC_TURNSTILE_SITE_KEY=${PUBLIC_TURNSTILE_SITE_KEY}
# URL pubblico del portale Area Clienti (pulsante "Area Clienti" della Home): pubblico per natura.
ARG PUBLIC_CLIENT_AREA_URL
ENV PUBLIC_CLIENT_AREA_URL=${PUBLIC_CLIENT_AREA_URL}

RUN pnpm --filter nzt-solutions-web build

# ----------------- Final Minimal Stage -----------------
# Alpine: a runtime non servono moduli nativi né librerie di sistema, quindi si usa la base con la
# superficie più piccola (molte meno vulnerabilità di sistema rispetto a Debian slim).
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080

# A runtime serve solo `node`: i gestori di pacchetti dell'immagine base (npm, corepack, yarn) vengono
# rimossi, con le loro dipendenze e relative vulnerabilità. Poi gruppo e utente non privilegiati
# (principio del minimo privilegio).
RUN rm -rf /usr/local/lib/node_modules /opt/yarn-v* \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg && \
    addgroup -g 10001 -S appgroup && \
    adduser -u 10001 -S -G appgroup -h /app -s /sbin/nologin -H appuser

WORKDIR /app

# Solo l'output del build e il server: il bundle è autosufficiente (vite.ssr.noExternal), quindi
# nell'immagine finale non c'è node_modules, né pnpm, né alcuno strumento di build.
# I file restano di proprietà di root e in sola lettura per l'utente applicativo: un processo
# compromesso non può modificare il codice che esegue.
COPY --from=builder /app/frontend/landing/dist ./dist
COPY --from=builder /app/frontend/landing/server ./server

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Forma exec: Node riceve direttamente SIGTERM e chiude le connessioni in modo ordinato
CMD ["node", "server/index.mjs"]
