# Landing (Astro statico) -> nginx. Contesto di build: radice del monorepo.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/landing/package.json apps/landing/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile --filter @nzt/landing...
COPY packages/ui packages/ui
COPY apps/landing apps/landing
ARG PUBLIC_CLIENT_AREA_URL=https://clienti.nztsolutions.it
ENV PUBLIC_CLIENT_AREA_URL=$PUBLIC_CLIENT_AREA_URL
RUN pnpm --filter @nzt/landing build

FROM nginx:1.27-alpine
COPY --from=build /repo/apps/landing/dist /usr/share/nginx/html
EXPOSE 80
