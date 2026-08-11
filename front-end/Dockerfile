# Build context is the repo root (pnpm workspace) - see docker-compose.yml.
ARG NODE_VERSION=24.11.0-bookworm-slim

FROM node:${NODE_VERSION} AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HUSKY=0

RUN corepack enable

WORKDIR /app

FROM base AS deps

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY back-end/gateway/package.json back-end/gateway/package.json
COPY back-end/service-b/package.json back-end/service-b/package.json
COPY front-end/package.json front-end/package.json

RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build

COPY front-end front-end

RUN pnpm --filter front-end run build

# ---- Runtime: static files served by nginx ------------------------------
FROM nginx:1.27-alpine AS runtime

COPY front-end/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/front-end/dist/front-end/browser /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O- http://127.0.0.1/ || exit 1
