# Portale Area Clienti (Vite SPA) -> Caddy. Contesto di build: radice del monorepo.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/portal/package.json apps/portal/
COPY apps/admin/package.json apps/admin/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile --filter @nzt/portal...
COPY packages/ui packages/ui
COPY apps/portal apps/portal
# VITE_API_BASE_URL deve coincidere con NZT_API_PUBLIC_BASE_URL dell'API (claim DPoP htu).
ARG VITE_API_BASE_URL=https://api.nztsolutions.it
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm --filter @nzt/portal build

FROM caddy:2-alpine
COPY --from=build /repo/apps/portal/dist /srv/nzt-portal
COPY apps/portal/deploy/Caddyfile.local /etc/caddy/Caddyfile
EXPOSE 80
