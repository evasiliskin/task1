ARG NODE_VERSION=26.5.0-bookworm-slim

# ---- Base -------------------------------------------------------------
FROM node:${NODE_VERSION} AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HUSKY=0

RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g corepack@latest \
    && corepack enable

WORKDIR /app

FROM base AS deps

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY back-end/api-gateway/package.json back-end/api-gateway/package.json
COPY back-end/service-b/package.json back-end/service-b/package.json
COPY back-end/service-a/package.json back-end/service-a/package.json
COPY back-end/libs/shared/package.json back-end/libs/shared/package.json

RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ---- Build --------------------------------------------------------------
FROM deps AS build

COPY back-end/libs/shared back-end/libs/shared
COPY back-end/api-gateway back-end/api-gateway

RUN pnpm --filter api-gateway... run build

RUN pnpm deploy --filter api-gateway --prod /prod/api-gateway

# ---- Runtime ------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY --chown=node:node --from=build /prod/api-gateway ./

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "\
    const http = require('http'); \
    http.get('http://127.0.0.1:3000/api/v1/health/live', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1));"

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["node", "dist/main.js"]
