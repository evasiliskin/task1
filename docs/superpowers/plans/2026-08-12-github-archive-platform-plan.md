# GitHub Archive Import & Analytics Platform — Phased Roadmap

> **For agentic workers:** This is a **phase roadmap**, not a bite-sized execution plan.
> The design doc (`docs/superpowers/specs/2026-08-12-github-archive-platform-design.md`)
> covers 11 phases spanning three services, MongoDB, Redis, RabbitMQ, and a frontend — too
> large for one code-level plan with actual step-by-step code in every task (per
> `writing-plans`'s own Scope Check: a spec covering multiple independent subsystems gets
> broken into one plan per subsystem, each producing working, testable software on its
> own). **Before starting any phase below, invoke `superpowers:writing-plans` again scoped
> to just that phase** — it will produce a full bite-sized, code-level plan
> (`docs/superpowers/plans/YYYY-MM-DD-<phase-name>.md`) the same way this repo already did
> `config module` → `pino logger` → `correlation-id` as separate cycles. Then use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans` to execute
> that phase's plan.

**Goal:** Ship a memory-safe GitHub Archive ingestion pipeline (download or upload →
stream-decompress → stream-parse → validate/transform → batched MongoDB insert), a search
API over imported events, RabbitMQ domain events + RedisTimeSeries metrics, a `service-b`
that consumes those events into its own log store with a stats API and a PDF report, and
the `api-gateway`/frontend surface to drive all of it — in 11 dependency-ordered phases.

**Architecture:** See the design doc's "Architecture" diagram. Gateway stays the only
public HTTP surface; `service-a`/`service-b` stay RMQ-only (RPC for control-plane
messages, `emit`/`@EventPattern` for the three lifecycle events); large binaries (uploaded
archives, generated PDFs) move over a shared Docker volume, never through RabbitMQ or an
application `Buffer`.

**Tech Stack:** NestJS 11, TypeScript, `@nestjs/microservices` (RMQ transport), official
`mongodb` driver, `ioredis` (RedisTimeSeries via `TS.*` commands), `pdfkit`, Vitest,
Zod, `@task1/shared` (pnpm workspace package).

**Design doc:** `docs/superpowers/specs/2026-08-12-github-archive-platform-design.md`

## Global Constraints (apply to every phase)

- Never throw raw `Error` — extend `AppError` (`@task1/shared`'s `errors/` module, already
  used by all three services).
- No `any` — use `unknown` + Zod validation at boundaries.
- Every class member has explicit `public`/`private`/`protected` accessibility
  (`@typescript-eslint/explicit-member-accessibility`, already enforced repo-wide).
- Domain/business logic stays framework-independent where practical; infra adapters
  (Mongo, Redis, RabbitMQ publishers) are separate injectable classes — never call the
  driver/SDK directly from a controller or from orchestration code.
- Controllers: routing/validation/serialization only. No business logic, no Mongo/Redis
  access, no transactions — matches the existing gateway convention, now also applies to
  service-a/b's RMQ handlers (they play the "controller" role for their own module).
- Cursor pagination (`{createdAt/timestamp, _id-or-eventId}`), never `skip()`, on every
  list endpoint.
- UUID public identifiers everywhere (`importId`, etc.) — never expose a Mongo `_id` or
  sequential ID as a public identifier.
- All timestamps ISO-8601 UTC.
- No `git commit` in any step — per this project's `CLAUDE.md`, the user commits manually.
  Every "commit" checkpoint in a phase's own detailed plan should be written as "stage the
  files" instead.
- Vitest: colocated `*.spec.ts` (unit, mocked deps), `.int.spec.ts` (HTTP controllers via
  supertest) / `.spec.ts` via `Test.createTestingModule()` (RMQ-only handlers) — no
  Testcontainers, no live external services in the automated suite (confirmed against
  `skills/testing-development.md`). Coverage thresholds: 90% lines, 90% branches.
- BDD test naming: `it('should X, when Y')`.
- Reuse `@task1/shared` before adding new cross-cutting code — check `core/logger`,
  `core/request-context`, `core/errors`, `core/exception-handling` first.

---

## Phase 0: Shared foundations & infrastructure

**Goal:** Everything every later phase needs already in place — nothing business-logic-shaped
yet, just the scaffolding.

**Modules/files touched:**
- `back-end/libs/shared/src/github-archive/` — new subfolder: `events/` (three lifecycle
  event DTOs + `event-patterns.const.ts`), `contracts/github-event.dto.ts` (the whitelisted
  per-event-type shape). Exported from `back-end/libs/shared/src/index.ts`.
- `back-end/service-a/src/config/` — new `mongodb.config.ts`, `redis.config.ts`,
  `storage.config.ts` (`STORAGE_DIR`, `MONGO_BATCH_SIZE` default 500), following the
  existing `registerAs` + Zod pattern (`app.config.ts`/`rabbitmq.config.ts` already show
  the shape).
- `back-end/service-a/src/infra/mongodb/` — a small `MongoClientModule`/`MongoClientService`
  provider (connects once at startup via a Nest lifecycle hook, exposes `getDb()`, closes
  on shutdown) — no ORM, official driver only.
- `back-end/service-a/src/infra/redis/` — equivalent `RedisClientModule`/`RedisClientService`
  wrapping `ioredis`, plus a `metrics.service.ts` with `recordMetric(key, value, labels)`
  that idempotently `TS.CREATE`s (with retention) on first use per key.
- `back-end/service-b/src/config/` + `src/infra/mongodb/` + `src/infra/redis/` — identical
  shape to service-a's (service-b needs its own DB/cache access; no cross-service imports of
  each other's infra modules — module boundary).
- `back-end/api-gateway/src/config/storage.config.ts` — `STORAGE_DIR`, `REPORT_DIR`.
- `docker-compose.yml` — `redis` image → `redis/redis-stack-server:latest`; new named
  volumes `archive-storage` (mounted in `api-gateway` + `service-a`) and `report-storage`
  (mounted in `api-gateway` + `service-b`); `service-a`/`service-b` gain `MONGODB_URI`/
  `REDIS_URL` environment entries (gateway already has them).
- `.env.example` for `service-a`, `service-b`, `api-gateway` — document every new var.

**Interfaces produced (later phases depend on these exact names):**
- `GithubEventDto` (shared) — the whitelisted per-event-type shape stored in Mongo.
- `ImportStartedEvent` / `ImportCompletedEvent` / `ImportFailedEvent` (shared) + `EVENT_PATTERNS.IMPORT_STARTED/COMPLETED/FAILED` string constants.
- `MongoClientService.getDb(): Db` (service-a and service-b, each their own instance/connection).
- `RedisClientService.getClient(): Redis` and `MetricsService.recordMetric(key: string, value: number, labels?: Record<string,string>): Promise<void>` (swallows Redis errors, logs a warning — never throws).
- Config: `storageConfig().dir`, `mongodbConfig().uri`, `redisConfig().url`, `mongodbConfig().batchSize`.

**Testable deliverable:** `docker compose up` starts cleanly with the new volumes/image;
`service-a`/`service-b` connect to Mongo/Redis at boot and log success (visible in
`docker compose logs`); `MetricsService.recordMetric` unit-tested against a mocked
`ioredis` client; config schemas unit-tested (valid/invalid/default cases, matching the
existing `app.config.spec.ts` pattern).

**Depends on:** nothing (first phase).

---

## Phase 1: Service-a — archive download

**Goal:** `downloadArchive(dateHour: string): Promise<string>` — streams one GH Archive
`.json.gz` to `STORAGE_DIR`, memory-bounded, safe on failure.

**Modules/files touched:**
- `back-end/service-a/src/archive/download/archive-url.util.ts` — `buildArchiveUrl(dateHour): string`, validates `^\d{4}-\d{2}-\d{2}-([0-9]|1[0-9]|2[0-3])$`.
- `back-end/service-a/src/archive/download/download-archive.ts` — the orchestration function (`stream.pipeline` HTTP response → temp file → rename; cleanup + typed `AppError` on any failure).
- `back-end/service-a/src/archive/download/errors.ts` — `ArchiveDownloadError extends AppError` (carries URL + HTTP status, never the response body).

**Interfaces produced:**
- `buildArchiveUrl(dateHour: string): string` (throws `InvalidDateHourError` on bad format).
- `downloadArchive(dateHour: string, storageDir: string): Promise<{ filePath: string }>`.

**Testable deliverable:** unit tests cover valid/invalid `dateHour` formats, a mocked HTTP
client returning success/4xx/5xx/connection-error/timeout, and that a failed download never
leaves a file at the final (non-`.tmp`) path. No RMQ/controller wiring yet — this phase is
pure, directly callable, fully unit-testable in isolation.

**Depends on:** Phase 0 (`storageConfig`).

---

## Phase 2: Service-a — archive processing pipeline

**Goal:** `processArchive(filePath: string, importId: string): Promise<ImportResult>` —
streams gzip → NDJSON → validate/transform → batched Mongo insert, memory-bounded
regardless of file size.

**Modules/files touched:**
- `back-end/service-a/src/archive/processing/split-lines.ts` — async generator, bounded
  trailing-partial-line buffer.
- `back-end/service-a/src/archive/processing/parse-and-validate.ts` — async generator,
  Zod schema for the minimal required GH event shape, counts+samples invalid lines.
- `back-end/service-a/src/archive/processing/transform-event.ts` — pure function, raw GH
  event → `GithubEventDto` (per-type payload whitelist from Phase 0's shared contract).
- `back-end/service-a/src/archive/processing/batch.ts` — async generator, yields arrays up
  to `mongodbConfig().batchSize`.
- `back-end/service-a/src/archive/processing/insert-batch.ts` — unordered `bulkWrite`,
  splits `E11000` duplicate errors from other failures.
- `back-end/service-a/src/archive/processing/process-archive.ts` — orchestration function
  wiring the above via `stream.pipeline`.
- `back-end/service-a/src/archive/imports.repository.ts` — `events`/`imports` collection
  access (index creation on module init, `insertImportRecord`, `updateImportStatus`).

**Interfaces produced:**
- `ImportResult { eventsProcessed, validEvents, invalidEvents, duplicateEvents, errorCount }`.
- `processArchive(filePath: string, importId: string): Promise<ImportResult>`.
- `ImportsRepository.ensureIndexes(): Promise<void>` (called once at startup).

**Testable deliverable:** unit tests for each generator/pure function in isolation (line
splitting across arbitrary chunk boundaries including a line split across two chunks;
validation accepting/rejecting sample GH event JSON; transform whitelisting per type;
batching respecting `batchSize`; duplicate-vs-error counting against a mocked Mongo
collection). One `.spec.ts` running the full pipeline against a small in-memory fixture
`.json.gz` (a few KB, checked into `test/fixtures/`) with a mocked Mongo client, asserting
final counters and that `insertBatch` was called more than once (proves batching, not one
giant insert).

**Depends on:** Phase 0 (Mongo client, shared `GithubEventDto`).

---

## Phase 3: Service-a — upload endpoint

**Goal:** `POST /v1/imports/upload` — gateway streams a multipart file straight to the
shared volume, triggers Phase 2's pipeline via a small RMQ message.

**Modules/files touched:**
- `back-end/api-gateway/src/imports/upload-import.controller.ts` — `FileInterceptor` with
  disk storage pointed at `STORAGE_DIR`, generates `importId`, temp-then-rename on the
  gateway side, sends `{ importId, filePath }` via `ClientProxy.send('archive.process.upload', ...)`.
- `back-end/service-a/src/archive/import.controller.ts` — new: `@MessagePattern('archive.process.upload')` handler that calls the Phase 1 orchestration wrapper (built in Phase 5) with a pre-existing file path instead of downloading one.
- `back-end/api-gateway/src/imports/dto/upload-import-response.dto.ts` — `{ importId }`.

**Interfaces consumed:** Phase 1's `downloadArchive` return shape (`{ filePath }`), Phase 2's `processArchive`.

**Testable deliverable:** gateway `.int.spec.ts` (supertest, mocked `ClientProxy`) asserting
a multipart upload writes to a mocked disk-storage path and sends the correct RMQ message;
service-a `.spec.ts` asserting the message handler invokes `processArchive` with the given
path.

**Depends on:** Phase 2.

---

## Phase 4: Service-a — search API & pagination

**Goal:** `GET /v1/events` with filters + cursor pagination, filtering entirely in MongoDB.

**Modules/files touched:**
- `back-end/service-a/src/events/events.repository.ts` — `findEvents(filter, cursor, limit): Promise<{ data, nextCursor }>` building a Mongo filter + `{createdAt,eventId}` keyset query.
- `back-end/service-a/src/events/search-events.dto.ts` — filter/pagination DTO (Zod/class-validator).
- `back-end/service-a/src/events/events.controller.ts` (RMQ) — `@MessagePattern('events.search')`.
- `back-end/api-gateway/src/events/events.controller.ts` (HTTP) — `GET /v1/events`, validates query params, forwards via `ClientProxy.send`, maps response, Swagger decorators.

**Interfaces produced:** `SearchEventsQuery { type?, repository?, actor?, from?, to?, cursor?, limit? }`, `SearchEventsResult { data: GithubEventDto[], nextCursor?: string }`.

**Testable deliverable:** repository unit tests against a mocked Mongo collection asserting
the correct filter/sort/limit shape per input combination and correct `nextCursor`
derivation; gateway `.int.spec.ts` covering valid filters, invalid query params (400),
and cursor round-trip.

**Depends on:** Phase 0, Phase 2 (data already in `events` collection to query against, at least in tests via fixtures).

---

## Phase 5: Service-a — RabbitMQ domain events + RedisTimeSeries metrics

**Goal:** Wrap Phases 1+2 in the `importArchive` orchestration that emits lifecycle events
and records metrics — the piece that ties download/upload into one real import flow.

**Modules/files touched:**
- `back-end/service-a/src/archive/import-archive.ts` — orchestration function per the
  spec's pseudocode: mints `importId` (skipped if the upload flow already minted one),
  emits `import.started`, calls `processArchive`, emits `import.completed`/`import.failed`,
  records `service_a.archive.*` metrics at each stage.
- `back-end/service-a/src/archive/download-import.controller.ts` — `@MessagePattern('archive.import.download')`, the gateway-facing trigger for a download-based import; calls `downloadArchive` then `importArchive`.
- Wires `MetricsService.recordMetric` calls into Phase 2's batch/error paths (`service_a.archive.events.processed/.invalid`, `service_a.archive.processing.errors`) and Phase 1's download path (`service_a.archive.download.duration`).
- `back-end/api-gateway/src/imports/trigger-import.controller.ts` — `POST /v1/imports` (download-triggered), `Idempotency-Key` header check against the `imports` collection.

**Interfaces produced:** `importArchive(source: DownloadSource | UploadSource, importId?: string): Promise<ImportResult>`. Emits via `ClientProxy.emit(EVENT_PATTERNS.IMPORT_STARTED/COMPLETED/FAILED, payload)`.

**Testable deliverable:** unit test asserting the emit sequence (started → completed) on
success and (started → failed) on a thrown error, using a mocked `ClientProxy`; asserting
metrics are recorded at each stage via a mocked `MetricsService`; gateway `.int.spec.ts` for
`POST /v1/imports` including the `Idempotency-Key` replay case.

**Depends on:** Phase 1, Phase 2, Phase 0.

---

## Phase 6: Service-b — RabbitMQ consumer & processing-log storage

**Goal:** Consume the three lifecycle events idempotently into service-b's own MongoDB
collection.

**Modules/files touched:**
- `back-end/service-b/src/processing-log/processing-log.repository.ts` — `upsertLog(entry)` keyed by `{importId, status}` (unique index), `ensureIndexes()`.
- `back-end/service-b/src/processing-log/import-events.controller.ts` — three `@EventPattern` handlers (`github.import.started/.completed/.failed`), each: Zod-validate → `upsertLog` → manual ack; on repository failure, nack+requeue (bounded retry via a header counter, dead-letter after N attempts).
- `back-end/service-b/src/config/rabbitmq.config.ts` additions: `prefetchCount` (default 10), `maxRetries` (default 5).

**Interfaces produced:** `ProcessingLogEntry { importId, archive, status, service, timestamp, correlationId, metadata, errorInfo? }`, `ProcessingLogRepository.upsertLog(entry): Promise<void>`.

**Testable deliverable:** `.spec.ts` (via `Test.createTestingModule()`, mocked repository +
mocked `RmqContext`) covering: valid message → ack; malformed message → rejected/logged, not
crashed; repository throw → nack+requeue; a message with an `importId`/`status` pair already
stored → upsert is a no-op that still acks (idempotency).

**Depends on:** Phase 0, Phase 5 (the event shapes it consumes).

---

## Phase 7: Service-b — log query API

**Goal:** `GET /v1/logs` with the same filter/cursor-pagination shape as Phase 4.

**Modules/files touched:**
- `back-end/service-b/src/processing-log/processing-log.repository.ts` — add `findLogs(filter, cursor, limit)`.
- `back-end/service-b/src/processing-log/logs.controller.ts` (RMQ) — `@MessagePattern('logs.search')`.
- `back-end/api-gateway/src/logs/logs.controller.ts` (HTTP) — `GET /v1/logs`.

**Testable deliverable:** same shape of tests as Phase 4 (repository filter/pagination unit
tests, gateway `.int.spec.ts`).

**Depends on:** Phase 6.

---

## Phase 8: Service-b — processing statistics API

**Goal:** `GET /v1/stats` computed via MongoDB aggregation + RedisTimeSeries range reads,
never by loading raw logs into Node.

**Modules/files touched:**
- `back-end/service-b/src/stats/stats.repository.ts` — `getStats(importId?)`: Mongo
  aggregation (`$match` + `$group` by status, sum counters) + `RedisClientService`
  `TS.RANGE` calls for time-bucketed series.
- `back-end/service-b/src/stats/stats.controller.ts` (RMQ) — `@MessagePattern('stats.get')`.
- `back-end/api-gateway/src/stats/stats.controller.ts` (HTTP) — `GET /v1/stats`.

**Interfaces produced:** `StatsResult { archivesProcessed, eventsProcessed, successfulEvents, invalidEvents, processingDurationMs, errors }` (per the assignment's example shape) plus a `timeSeries` field for chart data, reused as-is by Phase 9.

**Testable deliverable:** repository unit test asserting the aggregation pipeline stages
against a mocked Mongo `aggregate` call and correct shaping of a mocked `TS.RANGE` reply;
gateway `.int.spec.ts` for the endpoint.

**Depends on:** Phase 6.

---

## Phase 9: Service-b — PDF report generation

**Goal:** `GET /v1/reports/pdf` — pdfkit report streamed to the shared `report-storage`
volume, downsampled charts, streamed back through the gateway.

**Modules/files touched:**
- `back-end/service-b/src/reports/downsample-series.ts` — pure function capping a time
  series to ~50 points (used when `TS.RANGE`'s own `AGGREGATION` isn't sufficient, e.g. very
  short ranges).
- `back-end/service-b/src/reports/build-report.ts` — orchestration: gathers Phase 8's
  `StatsResult`, calls `downsampleSeries` if needed, builds the pdfkit document, pipes to
  `createWriteStream(reportPath)`.
- `back-end/service-b/src/reports/report-charts.ts` — step functions: `drawBarChart`,
  `drawLineChart` (pdfkit vector primitives, labeled axes/legend).
- `back-end/service-b/src/reports/generate-report.controller.ts` (RMQ) — `@MessagePattern('reports.pdf.generate')`, returns `{ reportPath }`.
- `back-end/api-gateway/src/reports/reports.controller.ts` (HTTP) — `GET /v1/reports/pdf`,
  streams the file from `REPORT_DIR` to the HTTP response, deletes it after the response
  finishes (`res.on('finish', ...)`).

**Testable deliverable:** `downsampleSeries` unit-tested against series longer/shorter than
the cap; `build-report` unit test asserting `doc.pipe` is called with a writable pointed at
the expected path and that chart-drawing functions receive an array capped at the expected
length (proves no unbounded iteration); gateway `.int.spec.ts` asserting the response has
the correct `Content-Type: application/pdf` and that the temp file is removed after the
response completes (via a mocked filesystem or a temp-dir-per-test).

**Depends on:** Phase 6, Phase 8.

---

## Phase 10: Gateway wiring, frontend, memory-benchmark script, README

**Goal:** Everything user-facing and demonstrable end-to-end.

**Modules/files touched:**
- `back-end/api-gateway/src/app.module.ts` — wires all new controllers/modules from Phases 3–9.
- Swagger decorators/examples on every new gateway endpoint (`@nestjs/swagger`).
- `back-end/service-a/scripts/bench-memory.ts` + `package.json` script
  `"bench:memory": "tsx scripts/bench-memory.ts"` — runs the real `importArchive` flow
  against a running `docker compose` stack, sampling `process.memoryUsage().rss` on an
  interval, printing alongside bytes-read-so-far.
- `front-end/src/app/` — pages: trigger import (download date/hour picker + upload form),
  import status view (polls `GET /v1/imports/:id`), event search, log viewer, stats view,
  PDF download button.
- `README.md` — sections per the design doc's "Documentation" requirements: architecture,
  GitHub Archive rationale/format, data flow, memory considerations (why `arrayBuffer()`/
  `.text()`/full buffering are never used, how backpressure works, why batching), pagination
  strategy, MongoDB indexes, RabbitMQ event flow, RedisTimeSeries metrics, trade-offs (link
  to the design doc's "Out of scope" section rather than duplicating it).

**Testable deliverable:** `docker compose up --build` brings up the full stack; a manual
walkthrough (documented in the README) exercises every capability end-to-end: trigger a
download import for a real hour, watch status reach `completed`, search the imported
events, view logs, view stats, download a PDF that opens and shows real charts; running
`bench:memory` against a multi-hundred-MB archive shows RSS staying flat rather than
growing with bytes consumed.

**Depends on:** Phases 1–9.

---

## Self-Review

**Spec coverage:** every numbered section of the design doc maps to a phase above —
infra/shared (0), download (1), processing (2), upload (3), search (4), events+metrics (5),
consumer/logs (6, 7), stats (8), PDF (9), gateway/frontend/bench/README (10). gRPC is
explicitly out of scope per the design doc and not listed as a phase.

**Placeholder scan:** no TBD/TODO; every phase names concrete files, function signatures,
and test assertions rather than "add appropriate tests" — appropriate for a *phase
roadmap's* level of detail (interfaces and test *intent*, not full step-by-step code), which
is what this document is; the code-level detail with actual test code and commit-by-commit
steps is deferred to each phase's own plan, per the header note and consistent with the
approved design doc.

**Type/name consistency across phases:** `ImportResult` (Phase 2) is reused unchanged by
Phase 5. `GithubEventDto` (Phase 0) is reused unchanged by Phases 2 and 4.
`StatsResult` (Phase 8) is reused unchanged by Phase 9. `EVENT_PATTERNS.*` (Phase 0) is
reused unchanged by Phases 5 and 6. `storageConfig()`/`mongodbConfig()`/`redisConfig()`
(Phase 0) are reused unchanged by every later phase that touches storage/Mongo/Redis.
