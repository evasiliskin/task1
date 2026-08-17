# task1

A NestJS microservices backend that ingests [GH Archive](https://www.gharchive.org/) hourly event
dumps and exposes the imported data — plus processing history, statistics and PDF reports — over a
single REST API.

pnpm workspace monorepo. Three runnable services and one shared library.

## What it does

- Starts an **import** either by downloading a GH Archive hour (`YYYY-MM-DD-H`) from
  `data.gharchive.org`, or by accepting an uploaded `.json.gz` archive.
- Streams the gzipped newline-delimited JSON, validates and reshapes each event, and bulk-inserts it
  into MongoDB, counting valid / invalid / duplicate / errored records.
- Emits import lifecycle events, which a second service turns into a queryable **processing log**
  and into aggregate **statistics**.
- Serves search over imported events, search over the processing log, statistics, per-import status,
  and a generated **PDF report**.

## Architecture

```text
                    Client
                      │ HTTP  /api/v1  (only public surface)
                      ▼
                 api-gateway ─────────────────────────────┐
                      │                                   │
        RPC  send/@MessagePattern            emit/@EventPattern
                      │                                   │
        ┌─────────────┴─────────────┐          service_a_imports_queue
        ▼                           ▼                     │
    service-a                   service-b ◀───────────────┘ (import work)
  service_a_queue             service_b_queue
        │                           ▲
        │   emit/@EventPattern      │  github.import.started|completed|failed
        └───────────────────────────┘
        │                           │
        ▼                           ▼
  MongoDB service_a           MongoDB service_b
  events, imports             processing-logs, stats-rollups

        Redis (RedisTimeSeries metrics; gateway also uses it for rate-limit storage)
        Shared volumes: /data/archives (gateway ⇄ service-a), /data/reports (service-b → gateway)
```

- **api-gateway** is the only process with an HTTP listener. `service-a` and `service-b` are
  reachable exclusively as RabbitMQ consumers.
- Reads and status lookups are **synchronous RPC**; import work and cross-service notifications are
  **asynchronous fire-and-forget**. Both run over the same RabbitMQ transport — see
  [Communication](#communication).
- Each service owns its own MongoDB database. No service reads another's collections.
- Two filesystem locations are shared between services by design; see
  [Data and state ownership](#data-and-state-ownership).

## Services

| Package                                                          | Role                                                                                                                                       | Owns                                                                        | Talks to                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`back-end/api-gateway`](back-end/api-gateway)                   | Public REST API (`/api/v1`, Swagger at `/api-docs`) — validation, response enveloping, auth seam, rate limiting, HTTP↔RabbitMQ translation | Nothing persistent                                                          | RabbitMQ (both services), Redis (throttler + health)                           |
| [`back-end/service-a`](back-end/service-a)                       | GH Archive ingestion: download/upload handling, streaming parse, event persistence, import-run tracking, event search                      | Mongo `service_a`: `events`, `imports`; archive files on disk               | MongoDB, Redis (metrics), RabbitMQ (consumes; publishes events to `service-b`) |
| [`back-end/service-b`](back-end/service-b)                       | Processing log, aggregate statistics, PDF report generation                                                                                | Mongo `service_b`: `processing-logs`, `stats-rollups`; report files on disk | MongoDB, Redis (reads metrics), RabbitMQ (consumes only)                       |
| [`back-end/libs/shared`](back-end/libs/shared) (`@task1/shared`) | Cross-cutting infrastructure and message contracts                                                                                         | —                                                                           | —                                                                              |

Each service directory has its own README with the details specific to it.

## Communication

All inter-service traffic is RabbitMQ, via `@nestjs/microservices`' RMQ transport. There are **no
custom exchanges** — the default exchange is used, so the routing key is the queue name. Queues are
durable and consumers use manual acknowledgement (`noAck: false`).

**Queues**

| Queue                     | Consumer  | Prefetch | Carries                                |
| ------------------------- | --------- | -------- | -------------------------------------- |
| `service_a_queue`         | service-a | 20       | RPC requests                           |
| `service_a_imports_queue` | service-a | 2        | import work (events)                   |
| `service_b_queue`         | service-b | 10       | RPC requests + import lifecycle events |

**Request/response (RPC)** — `ClientProxy.send` → `@MessagePattern`. Every gateway call is wrapped
in an rxjs `timeout(RABBITMQ_RPC_TIMEOUT_MS)` (default 10s). Patterns:
`events.search`, `logs.search`, `stats.get`, `reports.pdf.generate`, `imports.status.get`,
`imports.claim`, `health.check`.

**Events (fire-and-forget)** — `ClientProxy.emit` → `@EventPattern`. Nothing waits for a reply.

- gateway → service-a: `archive.import.download`, `archive.process.upload`
- service-a → service-b: `github.import.started`, `github.import.completed`, `github.import.failed`

Both pattern sets are declared once in `@task1/shared` (`messaging/rpc-patterns.const.ts`,
`github-archive/events/event-patterns.const.ts`) and imported by producer and consumer alike.

**Payload contracts.** Producers send plain objects. Every consumer re-validates the payload with a
Zod schema at the handler boundary; a payload that fails validation is logged and acked (never
retried, since a retry would fail identically).

**Retry and dead-lettering.** Each main queue is declared with
`x-dead-letter-routing-key: <queue>.dlq` on the default exchange. `MessagingModule` additionally
declares, at bootstrap, a `<queue>.retry` queue that dead-letters back to `<queue>`. When an event
handler throws, `RetryPublisher` republishes the message to `<queue>.retry` with a per-message TTL
(exponential backoff with 20% jitter, capped at `RABBITMQ_MAX_RETRY_DELAY_MS`) and an incremented
`x-retry-count` header; once `RABBITMQ_MAX_RETRIES` is exceeded, the message goes to `<queue>.dlq`.
This retry topology is wired for `service_a_imports_queue` and `service_b_queue` — `service_a_queue`
(RPC only) has a DLQ but no retry queue, because RPC failures are propagated to the caller instead.
Every republish is a mandatory, persistent publish awaited under a publisher confirm bounded by
`RABBITMQ_PUBLISH_CONFIRM_TIMEOUT_MS`; a broker that is reachable but not confirming (a resource
alarm, for example) makes the republish fail rather than hang, and the original delivery is nacked
to the dead-letter exchange instead of being left unsettled.

**Error propagation.** A microservice handler's exception is caught by the shared
`RpcAppExceptionFilter`, which serialises it to `{ statusCode, code, category, message, … }` and
throws it back over the reply queue. On the gateway, `SerializedRpcErrorFormatStrategy` recognises
that shape and rebuilds the HTTP error envelope with the original status code, so a `404` raised in
`service-a` surfaces as a `404` to the client. RPC timeouts are mapped separately by
`TimeoutErrorFormatStrategy`.

**Correlation.** Every hop carries `x-correlation-id` (stable across the whole flow) and
`x-request-id` (fresh per hop). Outbound messages must go through `ContextPropagatingClient`, which
attaches the headers from the AsyncLocalStorage-backed `RequestContextService`; inbound messages are
restored by `RmqContextInterceptor`. Both IDs are stamped on every log line, and the gateway echoes
them on HTTP responses.

## Shared library (`@task1/shared`)

Consumed by all three services. It holds **infrastructure and contracts — no business rules**:

- **Message contracts**: RPC/event pattern constants, GH Archive event schemas, view DTOs
  (`IEventView`, `ILogView`, `IImportStatusView`, `IImportClaimView`).
- **Messaging infrastructure**: retry/dead-letter topology, `RetryPublisher`, ack helper.
- **Cross-cutting NestJS wiring**: request-context propagation, pino logging (HTTP and RMQ
  channels), exception handling with pluggable format strategies, the HTTP response envelope,
  Terminus health indicators, RedisTimeSeries metrics, Helmet config, Mongo/Redis connection
  lifecycle.
- **Shared conventions**: error hierarchy (`AppError` + categories), cursor pagination codec, and
  `storage/archive-paths.ts` — the archive filename convention the gateway writes and service-a
  reads.

The library is consumed through its `exports` map, which points at `dist/`. It must be built before
any service that imports it can run.

## Data and state ownership

| Store                                 | Owner                       | Notes                                                                                                                                                                       |
| ------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mongo `service_a` → `events`          | service-a                   | GH events; unique index on `eventId` makes re-import idempotent                                                                                                             |
| Mongo `service_a` → `imports`         | service-a                   | Import runs and idempotency claims                                                                                                                                          |
| Mongo `service_b` → `processing-logs` | service-b                   | One document per `(importId, status)`; TTL index from `PROCESSING_LOG_RETENTION_MS`                                                                                         |
| Mongo `service_b` → `stats-rollups`   | service-b                   | Single incrementally-maintained aggregate document                                                                                                                          |
| Redis (RedisTimeSeries)               | shared                      | service-a writes `service_a.archive.*`; both services write `<service>.rmq.<pattern>.requests/.errors`; service-b reads them for stats                                      |
| `STORAGE_DIR` (`/data/archives`)      | shared, split by filename   | Gateway writes `<uuid>.upload.tmp` → `<uuid>.json.gz`; service-a writes `<uuid>.download.tmp`, reads and deletes final archives. Each side only sweeps the suffixes it owns |
| `REPORT_DIR` (`/data/reports`)        | service-b writes and sweeps | Gateway only reads the path service-b returns, after asserting it is inside `REPORT_DIR`                                                                                    |

Direct database access never crosses a service boundary, and there are no distributed transactions.
Consistency between the two databases is eventual, carried by the import lifecycle events.

## Business rules worth knowing

- **Import identity.** `importId` is always server-generated. Supplying an `Idempotency-Key` (a
  UUID) makes the gateway resolve the id via the `imports.claim` RPC, which upserts on a unique
  partial index — replaying the same key returns the same `importId` and does not start a second
  import.
- **Single start per import.** `recordStarted` only matches documents without `startedAt`; a
  duplicate delivery raises `ImportAlreadyClaimedError`, which is acked rather than retried.
- **Upload validation** is by content: multer accepts `*.json.gz` names, then the gateway checks the
  gzip magic bytes and deletes the file if they do not match.
- **Streaming limits.** Processing is bounded by `ARCHIVE_MAX_DECOMPRESSED_BYTES` and
  `ARCHIVE_MAX_LINE_BYTES`; exceeding either aborts the import.
- **Partial success is normal.** Batches are inserted unordered; duplicate-key errors are counted as
  `duplicateEvents`, other write errors as `errorCount`, and the import still completes.
- **Archive cleanup.** Downloaded archives are always deleted after processing; uploaded archives are
  kept on failure so the upload can be retried.
- **Crash recovery.** On boot, service-a fails import runs stuck in `started` past three download
  timeouts and expires never-started claims; it also sweeps abandoned `.download.tmp` files. On
  shutdown it drains in-flight imports for up to `SHUTDOWN_DRAIN_TIMEOUT_MS` before exiting.
- **Statistics** come from an incrementally-maintained rollup document, seeded once from history on
  first boot. Roll-up is claimed per log entry with a `rolledUpAt` marker so a redelivered event
  cannot double-count. If Mongo or Redis is unreachable, stats return `degraded: true` rather than
  failing.

## Technology

NestJS 11 · TypeScript 5.7 (ESM, `nodenext`) · Node 26.5.0 · pnpm 11.21.0 · RabbitMQ (`amqplib`,
`@nestjs/microservices`) · MongoDB 7 via the native `mongodb` driver (no ORM) · Redis Stack
(RedisTimeSeries) via `ioredis` · Zod 4 for all validation · pino 10 for logging · `@nestjs/swagger`
· `@nestjs/terminus` · `@nestjs/throttler` · Helmet · PDFKit (service-b) · Vitest 4 + Testcontainers.

## Prerequisites

- Node **26.5.0** (`.nvmrc`; `engine-strict=true`, so a mismatch fails install)
- pnpm **11.21.0** (`packageManager`; `corepack enable`)
- Docker — required for the infrastructure stack and for integration tests

## Setup

```bash
pnpm install
```

Installs dependencies and the Husky hooks (`git push` runs `pnpm check`).

### Everything in Docker

```bash
pnpm docker:up
```

Builds and starts RabbitMQ, MongoDB, Redis Stack and all three services. The compose file supplies
every environment variable, so no `.env` is needed. The API is on <http://localhost:3000/api/v1>,
Swagger on <http://localhost:3000/api-docs>, the RabbitMQ management UI on <http://localhost:15672>.
Services wait for the infrastructure health checks before starting. `pnpm docker:down` stops it.

### Running services from source

```bash
docker compose up -d rabbitmq mongodb redis   # infrastructure only
pnpm build                                    # required once: services resolve @task1/shared from its dist/
pnpm dev:api-gateway                          # in separate shells
pnpm dev:service-a
pnpm dev:service-b
```

Every service defaults to `localhost` for RabbitMQ, MongoDB and Redis outside production, so no
environment variables are needed for this. Only `STORAGE_DIR` and `REPORT_DIR` need attention: their
defaults are relative paths resolved against each process's own working directory, so the gateway
and service-a (archives), and service-b and the gateway (reports), must be pointed at the same
absolute path to exchange files. Create the archive directory yourself before uploading — service-a
creates it on download and service-b creates the report directory on write, but the gateway's
multer storage does not.

Startup order does not matter — every RabbitMQ client reconnects, and the gateway reports missing
dependencies through `/api/v1/health` instead of failing to boot.

## Configuration

`ConfigModule.forRoot({ ignoreEnvFile: true })` in every service: **`.env` files are never loaded**.
`back-end/<service>/.env.example` documents the variables; to override a default outside Docker,
export it into the shell (or use `dotenv-cli`). Each config file is parsed by a Zod schema at
startup, so an invalid value fails the boot rather than surfacing later.

Values marked `requireInProduction` fall back to a localhost default when `NODE_ENV !== production`
and throw when it is. The per-service variables are listed in each service README; the ones that
must agree across services are:

| Variable                                                      | Must match                     | Because                                               |
| ------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------- |
| `RABBITMQ_URL`                                                | all three                      | same broker                                           |
| `RABBITMQ_SERVICE_A_QUEUE` / `RABBITMQ_QUEUE` (service-a)     | gateway ↔ service-a            | RPC queue name                                        |
| `RABBITMQ_SERVICE_A_IMPORTS_QUEUE` / `RABBITMQ_IMPORTS_QUEUE` | gateway ↔ service-a            | import queue name                                     |
| `RABBITMQ_SERVICE_B_QUEUE` / `RABBITMQ_QUEUE` (service-b)     | gateway, service-a ↔ service-b | service-b queue name                                  |
| `STORAGE_DIR`                                                 | gateway ↔ service-a            | shared archive volume; must be the same absolute path |
| `REPORT_DIR`                                                  | gateway ↔ service-b            | shared report volume; must be the same absolute path  |
| `REDIS_URL`                                                   | all three                      | metrics + rate-limit storage                          |

## Testing

```bash
pnpm test        # unit + gateway HTTP integration tests (Vitest), no infrastructure needed
pnpm test:int    # service-a / service-b integration tests — starts real containers via Testcontainers
pnpm lint
pnpm check       # lint + test; also runs on git push
```

Three tiers, deliberately separated:

- **Unit tests** — `*.spec.ts` colocated with the source, run by each package's `vitest.config.mts`
  (coverage thresholds: 90% lines and branches, reported by `test:cov`).
- **Gateway HTTP integration** — `src/**/*.int.spec.ts`, Supertest against a real Nest application
  with the RabbitMQ `ClientProxy` mocked. Runs as part of `pnpm test`.
- **Service integration** — `back-end/service-{a,b}/test/int/*.int.spec.ts`, run only by
  `pnpm test:int` with a separate config (serial, long timeouts). These start real RabbitMQ, MongoDB
  and Redis Stack containers, so **Docker must be running**.

There is no e2e suite spanning all three services.

## Infrastructure

`docker-compose.yml` is a **local development environment**, not a production deployment
description. It defines RabbitMQ (management image), MongoDB 7, Redis Stack, and the three services
built from their per-service multi-stage Dockerfiles (`pnpm deploy --prod` into a slim runtime
image, `tini` as PID 1, non-root `node` user, memory/CPU limits, 90s stop grace period). The gateway
health check hits `/api/v1/health/live`; the two RabbitMQ-only services write a readiness marker file
at boot and the health check stats it. Two named volumes, `archive-storage` and `report-storage`,
provide the shared directories described above. There is no CI configuration in the repository.

## Security

- **Helmet** on all gateway routes, with a relaxed CSP only for `/api-docs`.
- **Rate limiting** via `@nestjs/throttler` with Redis storage — global default
  `THROTTLE_LIMIT`/`THROTTLE_TTL_MS`, a tighter `THROTTLE_UPLOAD_LIMIT` on the upload route, skipped
  entirely on health routes.
- **Request validation**: every gateway request body/query/params is parsed by a strict Zod schema;
  unknown keys are rejected.
- **Authentication is a deliberate placeholder.** `AuthGuard` is registered globally and has the full
  structure (a `@Public()` override, `UnauthenticatedError`, a single `isAuthenticated()` seam), but
  that method unconditionally returns `true`, so **no endpoint currently requires credentials**. The
  code comment marks it as the insertion point for a real provider. Treat the API as unauthenticated.
- Logs redact sensitive fields; secrets are supplied only as environment variables.

## Known gaps

- No authentication (see above) and no authorization/roles anywhere.
- No CI pipeline; `pnpm check` on `git push` is the only automated gate.
- Reports are written to a shared volume rather than object storage, which ties the gateway and
  service-b to the same host or a shared mount.
