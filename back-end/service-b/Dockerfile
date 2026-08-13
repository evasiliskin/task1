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
COPY back-end/api-gateway/package.json back-end/api-gateway/package.json
COPY back-end/service-b/package.json back-end/service-b/package.json
COPY back-end/service-a/package.json back-end/service-a/package.json
COPY back-end/libs/shared/package.json back-end/libs/shared/package.json
COPY front-end/package.json front-end/package.json

RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ---- Build --------------------------------------------------------------
FROM deps AS build

COPY back-end/libs/shared back-end/libs/shared
COPY back-end/service-b back-end/service-b

RUN pnpm --filter service-b... run build

RUN pnpm deploy --filter service-b --prod /prod/service-b

# ---- Runtime ------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --chown=node:node --from=build /prod/service-b ./

USER node

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["node", "dist/main.js"]
