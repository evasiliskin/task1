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

FROM base AS deps

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY back-end/gateway/package.json back-end/gateway/package.json
COPY back-end/users-service/package.json back-end/users-service/package.json
COPY back-end/products-service/package.json back-end/products-service/package.json
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
  CMD node -e "\
    const http = require('http'); \
    const check = (path) => new Promise((resolve, reject) => { \
      http.get('http://127.0.0.1:3000' + path, (r) => (r.statusCode === 200 ? resolve() : reject())).on('error', reject); \
    }); \
    Promise.all([check('/health/users-service'), check('/health/products-service')]) \
      .then(() => process.exit(0)) \
      .catch(() => process.exit(1));"

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["node", "dist/main.js"]
