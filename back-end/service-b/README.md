# service-b

Processing history and analytics. Turns `service-a`'s import lifecycle events into a queryable
processing log, maintains aggregate statistics, and generates PDF reports.

RabbitMQ-only microservice (`NestFactory.createMicroservice`) — **no HTTP listener**.

See the [root README](../../README.md) for system architecture and shared messaging conventions.

## Owns

- MongoDB database `service_b`:
  - `processing-logs` — one document per `(importId, status)`, enforced by a unique index, which
    makes event handling idempotent under redelivery. Indexed for cursor-paginated search and given
    a TTL index driven by `PROCESSING_LOG_RETENTION_MS`.
  - `stats-rollups` — a single document holding running aggregate totals.
- PDF files in `REPORT_DIR`, written on demand and swept after `REPORT_RETENTION_MS`.

## Inbound messages

One queue, `service_b_queue` (prefetch 10), carrying both kinds of traffic:

| Pattern                                            | Kind                    | Effect                                                   |
| -------------------------------------------------- | ----------------------- | -------------------------------------------------------- |
| `github.import.started` / `.completed` / `.failed` | event (`@EventPattern`) | Upsert a processing-log entry and apply its rollup delta |
| `logs.search`                                      | RPC                     | Cursor-paginated processing-log search                   |
| `stats.get`                                        | RPC                     | Aggregate or per-import statistics                       |
| `reports.pdf.generate`                             | RPC                     | Build a PDF and return its path                          |
| `health.check`                                     | RPC                     | Mongo + Redis indicators                                 |

It **publishes nothing** — service-b is a terminal consumer.

## Event handling and idempotency

Each event is Zod-validated; a malformed payload is logged and acked (never retried). A valid event
is upserted on `(importId, status)`, then the entry is claimed for roll-up by setting `rolledUpAt`
in a conditional update — only the update that actually modifies the document applies the delta, so
a redelivered event cannot double-count. If the rollup write fails, the claim is released and the
error propagates so the retry path can run.

A write failure goes to the shared `RetryPublisher` (`service_b_queue.retry` → `.dlq`). When the
message is finally dead-lettered, the handler makes a last attempt to record the entry with status
`dead-lettered`, so a permanently failing event is still visible in `GET /logs`.

## Statistics

`stats.get` has two modes:

- **Aggregate** (no `importId`) — reads the `stats-rollups` document, falling back to a full
  aggregation pipeline over `processing-logs` if the rollup has not been seeded yet.
  `StatsRollupSeedService` seeds it once from existing history at bootstrap.
- **Per import** — reads that import's (at most four) log entries directly.

Average processing duration and the events-processed time series come from RedisTimeSeries series
written by `service-a` (`service_a.archive.processing.duration`, `.events.processed`). If MongoDB or
Redis is unreachable, the reply carries `degraded: true` with zeroed sections rather than failing —
the caller gets a partial answer instead of a 500.

## Reports

`reports.pdf.generate` fetches the same statistics, renders them with PDFKit (summary section,
status breakdown chart, events-over-time chart) into
`REPORT_DIR/<importId>-<uuid>.pdf` (or `<uuid>.pdf` for the aggregate report), and returns the path.
The gateway then streams that file.

The unique suffix per generation and the retention sweep are deliberate: two owners for one file
previously allowed the sweeper to unlink a report between generation and download.
`REPORT_RETENTION_MS` must stay comfortably above the gateway's `RABBITMQ_RPC_TIMEOUT_MS`.

## Log search

Keyset pagination sorted by `(timestamp, _id)` descending with an opaque base64url cursor. Filters:
`importId`, `status` (`started` | `completed` | `failed` | `dead-lettered`), `from`/`to` on
`timestamp`.

## Dependencies

MongoDB · Redis (RedisTimeSeries reads; metrics writes from the shared RMQ interceptor) · RabbitMQ ·
`REPORT_DIR` shared with the gateway · `@task1/shared`. It never calls another service.

## Configuration

| Variable                                                  | Default                                                        | Purpose                              |
| --------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------ |
| `RABBITMQ_URL`                                            | localhost (required in production)                             | Broker                               |
| `RABBITMQ_QUEUE`                                          | `service_b_queue`                                              | Own listener                         |
| `RABBITMQ_PREFETCH_COUNT`                                 | `10`                                                           | Concurrency                          |
| `RABBITMQ_MAX_RETRIES`                                    | `5`                                                            | Retries before dead-lettering        |
| `RABBITMQ_RETRY_DELAY_MS` / `RABBITMQ_MAX_RETRY_DELAY_MS` | `5000` / `600000`                                              | Backoff base and cap                 |
| `MONGODB_URI`                                             | `mongodb://localhost:27017/service_b` (required in production) | Database                             |
| `PROCESSING_LOG_RETENTION_MS`                             | `2592000000` (30 days)                                         | TTL index on `processing-logs`       |
| `REDIS_URL`                                               | localhost (required in production)                             | Metrics reads                        |
| `REDIS_METRICS_RETENTION_MS`                              | `604800000`                                                    | Time-series window used when reading |
| `REPORT_DIR`                                              | `./data/reports` (required in production)                      | Shared report directory              |
| `REPORT_RETENTION_MS` / `REPORT_SWEEP_INTERVAL_MS`        | `3600000` / `600000`                                           | Report cleanup                       |
| `HEALTH_PING_TIMEOUT_MS`                                  | `3000`                                                         | Mongo/Redis health ping              |
| `SERVICE_NAME`, `LOG_LEVEL`, `APP_LOG_TRANSPORT`          | `service-b`, `trace`/`info`, `json`                            | Logging                              |

`.env` files are not read — see the root README's Configuration section.

## Running and testing

```bash
pnpm dev:service-b                        # from the repo root, watch mode
pnpm --filter service-b run test          # unit tests
pnpm --filter service-b run test:int      # Testcontainers: MongoDB — needs Docker
pnpm --filter service-b run lint
```

`@task1/shared` must be built first (`pnpm build` at the root). Requires a reachable RabbitMQ,
MongoDB and Redis; `pnpm docker:up` provides all three. A readiness marker is written to
`/tmp/service-ready` at boot for the Docker health check.
