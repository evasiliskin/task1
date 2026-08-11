# Build context is the repo root (this is a pnpm workspace) - see
# docker-compose.yml: `build.context: .`, `build.dockerfile: back-end/gateway/Dockerfile`.
# Multi-stage layout ported from D:\Dev\tensi-backend\Dockerfile, trimmed to
# this app (no Prisma here - gateway has no database).
ARG NODE_VERSION=24.11.0-bookworm-slim

# ---- Base -------------------------------------------------------------
FROM node:${NODE_VERSION} AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HUSKY=0

RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

# ---- Dependencies (whole workspace, so pnpm can resolve it) -----------
FROM base AS deps

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY back-end/gateway/package.json back-end/gateway/package.json
COPY back-end/users-service/package.json back-end/users-service/package.json
COPY front-end/package.json front-end/package.json

RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ---- Build --------------------------------------------------------------
FROM deps AS build

COPY back-end/gateway back-end/gateway

RUN pnpm --filter gateway run build

# ---- Runtime ------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/back-end/gateway/dist ./dist
COPY --chown=node:node back-end/gateway/package.json ./package.json

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["node", "dist/main.js"]
