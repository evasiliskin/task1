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
COPY back-end/service-b/package.json back-end/service-b/package.json
COPY back-end/service-a/package.json back-end/service-a/package.json
COPY front-end/package.json front-end/package.json

RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ---- Build --------------------------------------------------------------
FROM deps AS build

COPY back-end/service-a back-end/service-a

RUN pnpm --filter service-a run build

# ---- Runtime ------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/back-end/service-a/dist ./dist
COPY --chown=node:node back-end/service-a/package.json ./package.json

USER node

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["node", "dist/main.js"]
