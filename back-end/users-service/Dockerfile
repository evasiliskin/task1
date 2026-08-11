ARG NODE_VERSION=24.11.0-bookworm-slim

# ---- Base -------------------------------------------------------------
FROM node:${NODE_VERSION} AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HUSKY=0

RUN apt-get update \
    && apt-get install -y --no-install-recommends tini openssl \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

FROM base AS deps

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY back-end/gateway/package.json back-end/gateway/package.json
COPY back-end/users-service/package.json back-end/users-service/package.json
COPY front-end/package.json front-end/package.json

RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS prisma

COPY back-end/users-service/prisma back-end/users-service/prisma

RUN DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder \
    pnpm --filter users-service run prisma:generate

# ---- Build --------------------------------------------------------------
FROM prisma AS build

COPY back-end/users-service back-end/users-service

RUN pnpm --filter users-service run build

# ---- Migrate (one-off job, see docker-compose.yml) -----------------------
FROM prisma AS migrate

ENTRYPOINT []
CMD ["pnpm", "--filter", "users-service", "exec", "prisma", "migrate", "deploy"]

# ---- Runtime ------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production
ENV USERS_SERVICE_HOST=0.0.0.0
ENV USERS_SERVICE_PORT=3001

WORKDIR /app

COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/back-end/users-service/dist ./dist
COPY --chown=node:node back-end/users-service/package.json ./package.json

USER node

EXPOSE 3001

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["node", "dist/main.js"]
