ARG NODE_VERSION=26.5.0-bookworm-slim

FROM node:${NODE_VERSION} AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HUSKY=0

RUN apt-get update \
    && apt-get install -y --no-install-recommends tini openssl \
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

FROM deps AS build

COPY back-end/libs/shared back-end/libs/shared
COPY back-end/service-a back-end/service-a

RUN pnpm --filter service-a... run build

RUN pnpm deploy --filter service-a --prod /prod/service-a

FROM base AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --chown=node:node --from=build /prod/service-a ./

RUN mkdir -p /data/archives && chown node:node /data/archives

USER node

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "\
    const amqp = require('amqplib'); \
    amqp.connect(process.env.RABBITMQ_URL) \
      .then((c) => c.close()) \
      .then(() => process.exit(0)) \
      .catch(() => process.exit(1));"

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["node", "dist/main.js"]
