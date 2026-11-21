# Pannello amministratore Area Clienti (Vite SPA) -> Caddy. Contesto di build: radice del monorepo.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY frontend/admin/package.json frontend/admin/
COPY frontend/portal/package.json frontend/portal/
COPY frontend/ui/package.json frontend/ui/
RUN pnpm install --frozen-lockfile --filter @nzt/admin...
COPY frontend/ui frontend/ui
COPY frontend/admin frontend/admin
# VITE_API_BASE_URL deve coincidere con NZT_API_PUBLIC_BASE_URL dell'API (claim DPoP htu).
ARG VITE_API_BASE_URL=https://api.nztsolutions.it
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm --filter @nzt/admin build

# Caddy compilato con l'ultima Go 1.27 (patch di sicurezza della libreria standard) e x/net aggiornata:
# il binario ufficiale di caddy:2-alpine arriva con le dipendenze del giorno della release.
FROM golang:1.27-alpine AS caddy
ENV CGO_ENABLED=0
RUN go install github.com/caddyserver/xcaddy/cmd/xcaddy@v0.4.7 \
    && xcaddy build --output /usr/bin/caddy --replace golang.org/x/net=golang.org/x/net@v0.62.0

FROM caddy:2-alpine
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
COPY --from=build /repo/frontend/admin/dist /srv/nzt-admin
COPY frontend/admin/deploy/Caddyfile.container /etc/caddy/Caddyfile
EXPOSE 80
