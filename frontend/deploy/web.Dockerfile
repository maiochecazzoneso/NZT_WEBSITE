# Un solo container Caddy per portale clienti + dashboard admin (due siti statici, due domini).
# Meno servizi = meno costi su Railway. Contesto di build: radice del monorepo.
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS build
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY frontend/portal/package.json frontend/portal/
COPY frontend/admin/package.json frontend/admin/
COPY frontend/ui/package.json frontend/ui/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @nzt/portal... --filter @nzt/admin...
COPY frontend/ui frontend/ui
COPY frontend/portal/src frontend/portal/src
COPY frontend/portal/public frontend/portal/public
COPY frontend/portal/index.html frontend/portal/package.json frontend/portal/tsconfig*.json frontend/portal/vite.config.ts frontend/portal/csp.config.ts frontend/portal/
COPY frontend/admin/src frontend/admin/src
COPY frontend/admin/public frontend/admin/public
COPY frontend/admin/index.html frontend/admin/package.json frontend/admin/tsconfig*.json frontend/admin/vite.config.ts frontend/admin/csp.config.ts frontend/admin/
# VITE_API_BASE_URL deve coincidere con NZT_API_PUBLIC_BASE_URL dell'API (claim DPoP htu).
ARG VITE_API_BASE_URL=https://api.nztsolutions.it
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm --parallel --filter @nzt/portal --filter @nzt/admin build

# Caddy compilato con l'ultima Go 1.27 (patch di sicurezza della libreria standard) e x/net aggiornata:
# il binario ufficiale di caddy:2-alpine arriva con le dipendenze del giorno della release.
FROM golang:1.27-alpine AS caddy
ENV CGO_ENABLED=0
RUN go install github.com/caddyserver/xcaddy/cmd/xcaddy@v0.4.7 \
    && xcaddy build --output /usr/bin/caddy --replace golang.org/x/net=golang.org/x/net@v0.62.0

FROM caddy:2-alpine
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
RUN apk add --no-cache zstd gzip \
    && addgroup -g 10001 -S appgroup \
    && adduser -u 10001 -S -G appgroup -h /srv -s /sbin/nologin -H appuser \
    && mkdir -p /config/caddy /data/caddy \
    && chown -R appuser:appgroup /config/caddy /data/caddy
COPY --from=build /repo/frontend/portal/dist /srv/portal
COPY --from=build /repo/frontend/admin/dist /srv/admin
COPY frontend/deploy/Caddyfile.web /etc/caddy/Caddyfile
RUN find /srv/portal /srv/admin -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.svg' \) -exec gzip -k -9 {} + -exec zstd -q -k -19 {} + \
    && apk del zstd gzip
ENV PORT=8080 API_ORIGIN=$VITE_API_BASE_URL XDG_CONFIG_HOME=/config XDG_DATA_HOME=/data
USER appuser
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["wget", "-q", "-T", "3", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
