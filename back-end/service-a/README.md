# service-a

GH Archive ingestion. Downloads or accepts archive files, streams them into MongoDB as normalised
GitHub events, tracks each import run, and serves event search.

RabbitMQ-only — it has **no HTTP listener**. (It bootstraps as a Nest _application_ rather than a
microservice purely so it can attach two RMQ listeners with different prefetch settings.)

See the [root README](../../README.md) for system architecture and shared messaging conventions.

## Owns

- MongoDB database `service_a`:
  - `events` — normalised GitHub events. Unique index on `eventId`, plus compound
    `(createdAt, eventId)` indexes for keyset pagination and per-field filters.
  - `imports` — one document per import run: source, status, timestamps, counters, error samples,
    and the idempotency claim. Unique indexes on `importId` and (partially) on `idempotencyKey`.
- Archive files in `STORAGE_DIR`: writes `<uuid>.download.tmp`, reads `<uuid>.json.gz`, deletes
  archives after processing, and sweeps only its own `.download.tmp` leftovers.

## Inbound messages

Two listeners, deliberately split so a long-running import cannot starve fast queries:

| Queue                     | Prefetch | Pattern                                                                | Kind                    |
| ------------------------- | -------- | ---------------------------------------------------------------------- | ----------------------- |
| `service_a_queue`         | 20       | `events.search`, `imports.status.get`, `imports.claim`, `health.check` | RPC (`@MessagePattern`) |
| `service_a_imports_queue` | 2        | `archive.import.download`, `archive.process.upload`                    | event (`@EventPattern`) |

RPC handlers ack in a `finally` block and let exceptions travel back to the caller. Import handlers
ack on success; on failure they hand the message to the shared `RetryPublisher`
(`service_a_imports_queue.retry` → `.dlq`). A payload that fails Zod validation is logged and acked
without retrying, and a duplicate import (`ImportAlreadyClaimedError`) is acked as a no-op.

## Outbound messages

Publishes to `service_b_queue` via `ContextPropagatingClient.emit` — fire-and-forget, failures are
logged and never abort the import:

- `github.import.started` — `{ importId, archive, startedAt }`
- `github.import.completed` — plus `eventsProcessed`, `validEvents`, `invalidEvents`,
  `duplicateEvents`, `errorCount`, `completedAt`
- `github.import.failed` — plus `failedAt`, `reason`

## Import pipeline

`ImportOrchestrationService` → `importArchive` runs the same sequence for both sources:

1. Record `started` in `imports` (only if the run has no `startedAt` yet) and emit
   `github.import.started`.
2. **download** source: fetch `<GITHUB_ARCHIVE_BASE_URL>/<dateHour>.json.gz` to a `.download.tmp`
   file with per-attempt and total timeouts and bounded retries.
   **upload** source: the file the gateway already placed in `STORAGE_DIR`.
3. Stream: read → `gunzip` → byte cap → line split (line cap) → Zod-validate → transform → batch →
   unordered `insertMany` with bounded concurrency. Invalid lines and non-duplicate write errors are
   counted and log-capped rather than aborting.
4. Record `completed`/`failed`, emit the matching event, write RedisTimeSeries metrics.
5. Delete the archive — always for downloads, and for uploads only when the import succeeded, so a
   failed upload can be retried.

Lifecycle services around it: `ImportRunReconciliationService` (on boot, fails runs stranded in
`started` and expires unused claims), `StorageCleanupService` (on boot, removes stale
`.download.tmp` files), `GracefulShutdownService` (drains in-flight imports on shutdown, up to
`SHUTDOWN_DRAIN_TIMEOUT_MS`), and a readiness marker written to `/tmp/service-ready` for the Docker
health check.

## Event search

Keyset pagination, newest first, sorted by `(createdAt, eventId)` descending; the opaque cursor is a
base64url-encoded `{ createdAt, eventId }` validated on decode. Filters: `type`, `repository`
(`repo.name`), `actor` (`actor.login`), `from`/`to` on `createdAt`. Each filter combination is
index-backed.

## Dependencies

MongoDB · Redis (RedisTimeSeries writes only) · RabbitMQ · `data.gharchive.org` (the only external
HTTP call in the system) · `@task1/shared`.

## Configuration

| Variable                                                    | Default                                                        | Purpose                       |
| ----------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------- |
| `RABBITMQ_URL`                                              | localhost (required in production)                             | Broker                        |
| `RABBITMQ_QUEUE` / `RABBITMQ_IMPORTS_QUEUE`                 | `service_a_queue` / `service_a_imports_queue`                  | Own listeners                 |
| `RABBITMQ_SERVICE_B_QUEUE`                                  | `service_b_queue`                                              | Event target                  |
| `RABBITMQ_RPC_PREFETCH` / `RABBITMQ_IMPORT_PREFETCH`        | `20` / `2`                                                     | Concurrency per listener      |
| `RABBITMQ_MAX_RETRIES`                                      | `5`                                                            | Retries before dead-lettering |
| `RABBITMQ_RETRY_DELAY_MS` / `RABBITMQ_MAX_RETRY_DELAY_MS`   | `5000` / `600000`                                              | Backoff base and cap          |
| `RABBITMQ_PUBLISH_CONFIRM_TIMEOUT_MS`                       | `10000`                                                        | Publisher-confirm deadline    |
| `MONGODB_URI`                                               | `mongodb://localhost:27017/service_a` (required in production) | Database                      |
| `MONGO_BATCH_SIZE` / `MONGO_INSERT_CONCURRENCY`             | `500` / `2` (max 8)                                            | Bulk insert tuning            |
| `REDIS_URL`                                                 | localhost (required in production)                             | Metrics                       |
| `REDIS_METRICS_RETENTION_MS`                                | `604800000`                                                    | RedisTimeSeries retention     |
| `STORAGE_DIR`                                               | `./data/archives` (required in production)                     | Shared archive directory      |
| `GITHUB_ARCHIVE_BASE_URL`                                   | `https://data.gharchive.org`                                   | Download source               |
| `ARCHIVE_DOWNLOAD_TIMEOUT_MS` / `_TOTAL_TIMEOUT_MS`         | `30000` / `600000`                                             | Per-attempt / whole download  |
| `ARCHIVE_DOWNLOAD_MAX_ATTEMPTS` / `_RETRY_DELAY_MS`         | `3` / `2000`                                                   | Download retries              |
| `ARCHIVE_MAX_DECOMPRESSED_BYTES` / `ARCHIVE_MAX_LINE_BYTES` | `4294967296` / `1048576`                                       | Decompression bomb guards     |
| `SHUTDOWN_DRAIN_TIMEOUT_MS`                                 | `60000`                                                        | Graceful-shutdown drain       |
| `HEALTH_PING_TIMEOUT_MS`                                    | `3000`                                                         | Mongo/Redis health ping       |
| `SERVICE_NAME`, `LOG_LEVEL`, `APP_LOG_TRANSPORT`            | `service-a`, `trace`/`info`, `json`                            | Logging                       |

`.env` files are not read — see the root README's Configuration section.

## Metrics

Written to RedisTimeSeries (`TS.ADD`, failures logged and swallowed):
`service_a.archive.download.duration`, `.processing.duration`, `.events.processed`,
`.events.invalid`, `.processing.errors`, `.imports.failed`, `.failure.duration`, plus
`service_a.rmq.<pattern>.requests` / `.errors` from the shared interceptor (`health.check`
excluded). `service-b` reads the processing-duration and events-processed series when building
statistics.

## Running and testing

```bash
pnpm dev:service-a                        # from the repo root, watch mode
pnpm --filter service-a run test          # unit tests
pnpm --filter service-a run test:int      # Testcontainers: RabbitMQ, MongoDB, Redis Stack — needs Docker
pnpm --filter service-a run lint
```

`@task1/shared` must be built first (`pnpm build` at the root). Requires a reachable RabbitMQ,
MongoDB and Redis to do useful work; `pnpm docker:up` provides all three.
