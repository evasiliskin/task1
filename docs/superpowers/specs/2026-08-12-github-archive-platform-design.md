# GitHub Archive Import & Analytics Platform — Design

Date: 2026-08-12

## Goal

Add a memory-safe GitHub Archive ingestion pipeline to `service-a` (download-and-import
one hourly `.json.gz` archive, or accept an uploaded equivalent file, stream-decompress
and stream-parse it as NDJSON, validate/transform each event, and batch-insert into
MongoDB), a search API over the imported events, RabbitMQ domain events announcing
import lifecycle, RedisTimeSeries metrics, a `service-b` that consumes those events into
its own processing-log store with a stats API and a PDF report, and the `api-gateway`/
frontend surface to drive all of it. The overriding constraint (per the assignment and
`CLAUDE.md`) is that **memory consumption must stay bounded regardless of archive size**
— no full-file buffers, no full-file arrays of events, no unbounded in-memory caches.

This spec covers the whole feature's architecture and contracts. It is deliberately too
large for one implementation plan — see "Phase decomposition" below, and
`docs/superpowers/plans/2026-08-12-github-archive-platform-plan.md` for the phased
roadmap. Each phase gets its own detailed code-level implementation plan (written via
`writing-plans`) when that phase actually starts, the same way this repo already did
`config module` → `pino logger` → `correlation-id` as separate spec/plan cycles.

## Current state (verified against the code, 2026-08-12)

- `gateway` is the only HTTP surface (Express, Swagger at `/api-docs`). `service-a` and
  `service-b` are `@nestjs/microservices` RMQ-only apps — no HTTP adapter at all.
- `gateway → service-a` and `gateway → service-b` communication today is limited to
  health-check pings (`ClientProxy.send('health.check', {})`, request/reply). `service-a`
  also pings `service-b` for its own health check. **No business message patterns exist
  yet.**
- `correlationId`/`requestId` propagation, structured pino logging, Zod-validated config,
  and centralized error handling (`AppError`/`InternalError`, `GlobalExceptionFilter`,
  `RpcAppExceptionFilter`) already exist in `back-end/libs/shared` (`@task1/shared`,
  a real pnpm workspace package) and are consumed by all three services. New code in this
  feature reuses all of it — no changes needed to that layer.
- `mongodb@7` and `ioredis@6` are already installed in `api-gateway`'s `package.json` but
  currently unused beyond a health-check ping (`MONGODB_URI`/`REDIS_URL` env vars already
  wired in `docker-compose.yml`). **No MongoDB collections, Redis usage, or business
  RabbitMQ messages exist anywhere in the codebase yet** — this feature is net-new
  business logic on top of already-solid cross-cutting infrastructure.
- `docker-compose.yml` runs `rabbitmq:3-management-alpine`, `mongo:7`, `redis:7-alpine` —
  the plain Redis image has no RedisTimeSeries module, so it must change (see
  "Infrastructure changes" below).

## Phase decomposition

Too large for one plan; broken into 11 phases, each independently shippable and testable:

| # | Phase | Depends on |
|---|-------|------------|
| 0 | Shared foundations: `libs/shared` domain event contracts, Mongo/Redis client provider modules, config additions, docker-compose infra changes | — |
| 1 | Service-a: archive download (streaming, temp-file pattern) | 0 |
| 2 | Service-a: archive processing pipeline (gunzip → NDJSON → validate/transform → batched Mongo insert) | 0 |
| 3 | Service-a: upload endpoint (gateway streams to shared volume, triggers pipeline from 2) | 2 |
| 4 | Service-a: search API + cursor pagination | 0, 2 |
| 5 | Service-a: RabbitMQ domain events + RedisTimeSeries metrics wired into the pipeline | 1, 2 |
| 6 | Service-b: RabbitMQ consumer + processing-log storage + idempotency | 0, 5 |
| 7 | Service-b: log query API | 6 |
| 8 | Service-b: processing statistics API | 6 |
| 9 | Service-b: PDF report generation (pdfkit, shared-volume streaming back through gateway) | 6, 8 |
| 10 | Gateway wiring (all routes + Swagger), frontend, memory-benchmark script, README | 1–9 |

gRPC for the PDF path is an explicit **future enhancement**, not built in this cycle (see
"Out of scope").

## Architecture

```
                          Angular frontend
                                 |
                                 | HTTP (REST, /v1/...)
                                 v
                          api-gateway (only public HTTP surface, no business logic)
                     ______________|______________
                    |                              |
              RabbitMQ RPC                    RabbitMQ RPC
             (small JSON only)               (small JSON only)
                    v                              v
               service-a                      service-b
              (RMQ-only)                     (RMQ-only)
                    |                              ^
                    | emit (fire-and-forget)        | consume, manual ack
                    +-------- RabbitMQ events ------+
                    |                              |
                    v                              v
              MongoDB (events, imports)     MongoDB (processing-logs)
                    |                              |
                    v                              v
              RedisTimeSeries               RedisTimeSeries

Shared Docker volume (file bytes only, never through RabbitMQ or gateway memory):
  gateway  --upload stream-->  archive-storage  <--read-- service-a
  service-b --write PDF-->     report-storage   <--stream-- gateway (response to client)
```

Gateway and service-a/b communicate **only** over the existing RMQ RPC pattern
(`ClientProxy.send`/`emit`) for control-plane messages — no new transport is introduced.
The two binary-payload operations (file upload, PDF download) route file *bytes* through
a Docker-Compose-managed shared volume instead, with only a `{importId, filePath}`-shaped
message crossing RabbitMQ. This keeps "service-a/b are RMQ-only, gateway is the only HTTP
surface" true while never putting large binaries on the broker or in an application
`Buffer` (violating both the RabbitMQ payload-size rule and the memory-safety rule).

## Infrastructure changes (`docker-compose.yml`)

- `redis` image changes from `redis:7-alpine` to `redis/redis-stack-server:latest` — a
  strict superset (same base Redis commands, `redis-cli ping` healthcheck keeps working)
  that adds the RedisTimeSeries module (`TS.*` commands), required by section 23 of the
  assignment.
- New named volumes: `archive-storage` (mounted at `STORAGE_DIR` in both `api-gateway` and
  `service-a`), `report-storage` (mounted at `REPORT_DIR` in both `api-gateway` and
  `service-b`). Both are plain bind-mounted-by-Compose named volumes — no new
  infrastructure component, just disk sharing between two containers that already talk to
  each other over RabbitMQ.
- `service-a` gains a `MONGODB_URI`/`REDIS_URL` environment (it needs its own DB/cache
  access now, unlike today where only the gateway pings them). Same for `service-b`.

## Shared package additions (`back-end/libs/shared`)

New `src/github-archive/` subfolder in the existing `@task1/shared` package (not a new
workspace package — this is exactly the "RabbitMQ event contracts / DTOs used by multiple
applications" case the assignment's `shared` guidance describes, and `@task1/shared`
already exists and is already consumed by all three services):

```
github-archive/
  events/
    import-started.event.ts     — { importId, archive, startedAt, correlationId }
    import-completed.event.ts   — { importId, archive, startedAt, completedAt,
                                     eventsProcessed, validEvents, invalidEvents,
                                     duplicateEvents, errorCount, correlationId }
    import-failed.event.ts      — { importId, archive, startedAt, failedAt, reason,
                                     correlationId }
    event-patterns.const.ts     — 'github.import.started' | '.completed' | '.failed'
  contracts/
    github-event.dto.ts         — the validated/whitelisted shape stored in Mongo,
                                   shared so service-a's insert path and the gateway's
                                   search-response mapping agree on one shape
```

No business logic lives here — pure types/constants/small Zod schemas, matching the
existing `@task1/shared` convention (it currently holds only cross-cutting
logging/config/error-handling code; this adds one cohesive, genuinely-shared domain
contract, not a dumping ground).

## Data model (`service-a`, MongoDB)

### `events` collection

| Field | Type | Notes |
|---|---|---|
| `eventId` | string | GitHub's own event `id`. Unique index. |
| `eventType` | string | e.g. `PushEvent`, `IssuesEvent`, `WatchEvent`. |
| `createdAt` | Date | From GH's `created_at`. |
| `actor` | `{ id, login }` | |
| `repo` | `{ id, name }` | |
| `org` | `{ id, login }` \| undefined | Only present when GH's event has one. |
| `importId` | string | Which import run inserted this event (traceability). |
| `payload` | object | **Whitelisted per event type, not the raw GH payload** — e.g. `PushEvent` keeps `{ ref, commitCount }`, not the full commit array; `IssuesEvent` keeps `{ action, issueTitle }` (truncated). Prevents unbounded document growth from payload types that can carry many nested items. |

Indexes:
- `{ eventId: 1 }` unique — idempotency (section 18) and dedup.
- `{ createdAt: -1, eventId: -1 }` — default keyset-pagination cursor when no filter is
  applied.
- `{ eventType: 1, createdAt: -1 }`, `{ 'repo.name': 1, createdAt: -1 }`,
  `{ 'actor.login': 1, createdAt: -1 }` — one compound index per common single-filter
  access pattern (filter field first, `createdAt` second so the same index serves both
  the filter and the sort/pagination). A query combining two filters uses whichever index
  has the best-matching prefix and lets Mongo filter the remainder in-memory on the
  already-narrowed result set — an intentional, documented trade-off, not an oversight;
  indexing every possible filter combination would be over-engineering for this data
  volume.

### `imports` collection

One document per import run (download-triggered or upload-triggered): `importId`
(UUID, public identifier), `source` (`{ type: 'download', archive: '2026-08-11-0.json.gz' }`
or `{ type: 'upload', filename }`), `status` (`started | processing | completed | failed`),
`countersEventsProcessed/validEvents/invalidEvents/duplicateEvents/errorCount`,
`startedAt`/`completedAt`, `errorSamples` (bounded array, max 5 truncated messages — never
every error).

## Service-a: download (Phase 1)

Orchestration function `downloadArchive(dateHour: string): Promise<string>`:

1. `buildArchiveUrl(dateHour)` — validates `dateHour` matches
   `^\d{4}-\d{2}-\d{2}-([0-9]|1[0-9]|2[0-3])$` (strict format check before string
   interpolation — the host is always the fixed `https://data.gharchive.org`, so this
   isn't classic SSRF, but malformed input is still rejected server-side rather than
   trusted, per `CLAUDE.md`'s validation rule) and returns the full URL.
2. `downloadToTempFile(url, destPath)` — `stream.pipeline(httpResponseStream,
   createWriteStream(destPath + '.tmp'))`; on success, `fs.rename` to the final
   `destPath`; on any error (non-2xx status, connection failure, timeout, stream error),
   `fs.unlink` the `.tmp` file and throw an `AppError` subclass carrying enough context
   for logs (URL, HTTP status if any) but never the raw response body.
3. Returns the final file path on the shared `archive-storage` volume.

Never `response.arrayBuffer()`/`.text()`, never manual chunk-array accumulation — the
HTTP client's response body stream is piped directly to the file write stream, so memory
use is independent of archive size (bounded by stream internal buffer sizes only).

## Service-a: processing pipeline (Phase 2, shared by download + upload)

Orchestration function `processArchive(filePath: string, importId: string): Promise<ImportResult>`:

```
createReadStream(filePath)
  -> zlib.createGunzip()
  -> splitLines()        (async generator: buffers only the current trailing partial
                           line between chunks — bounded memory regardless of file size)
  -> parseAndValidate()  (async generator: JSON.parse + Zod-validate each line; invalid
                           lines increment a counter + log a 200-char-truncated sample,
                           never accumulate; never throw for a single bad line)
  -> transform()         (async generator: maps raw GH event -> the whitelisted
                           GithubEventDto shape from libs/shared)
  -> batch(batchSize)    (async generator: yields arrays of up to `batchSize` dtos —
                           configurable via MONGO_BATCH_SIZE, default 500)
  -> insertBatch()       (async Writable-equivalent consumer: unordered bulk insert per
                           batch; catches per-document E11000 duplicate-key errors and
                           counts them separately from real failures; awaits each batch's
                           write before pulling the next — this is what makes backpressure
                           work: the pipeline can't outrun MongoDB)
```

Implemented via Node's native `stream.pipeline`/async generators — **no external NDJSON
package** (`split2`, `ndjson`, etc.). This keeps the dependency list small and the whole
pipeline auditable as one straight-line piece of orchestration code, matching the
project's step-function/orchestration-function split (`CLAUDE.md` section 3): `downloadArchive`
and `processArchive` are the orchestration functions; `buildArchiveUrl`, `splitLines`,
`parseAndValidate`, `transform`, `insertBatch`, `publishImportStarted/Completed/Failed`,
`recordMetric` are the step functions each doing one thing.

At the end of a successful run, `processArchive` returns
`{ eventsProcessed, validEvents, invalidEvents, duplicateEvents, errorCount }` — all plain
counters accumulated during the run (O(1) memory), never a collected list of the events
themselves.

## Service-a: upload endpoint (Phase 3)

`POST /v1/imports/upload` (gateway) accepts `multipart/form-data`. The gateway's
controller uses a streaming multipart parser (Nest's `FileInterceptor` with
`diskStorage` pointed at `STORAGE_DIR`, or an equivalent streaming-to-disk configuration —
**not** memory storage) to write the uploaded bytes directly to the shared
`archive-storage` volume under a generated `importId`-named path, using the same
temp-then-rename pattern as the download flow. Once the file is fully and safely on disk,
the gateway sends a small RMQ message `{ importId, filePath }` to service-a, which runs
the exact same `processArchive` from Phase 2 — no separate upload-specific processing
code.

## Service-a: search API & pagination (Phase 4)

`GET /v1/events?type=PushEvent&repository=foo/bar&actor=octocat&from=...&to=...&cursor=...&limit=50`.
Gateway validates query params (whitelist of filter keys, `limit` capped e.g. at 200) and
forwards as a small DTO via RMQ RPC to service-a, which builds a MongoDB filter from the
provided fields and paginates via keyset cursor (`{ createdAt, eventId }`, matching the
default index) rather than `skip()`. Response includes `data` and `nextCursor` (undefined
when exhausted) — the client passes `nextCursor` back as the next request's `cursor`.
Filtering and sorting happen entirely inside MongoDB; service-a never loads more than one
page's worth of documents into Node.

## Service-a: RabbitMQ domain events (Phase 5)

`processArchive`'s caller (the import orchestration, matching `CLAUDE.md`'s
`importArchive` example) wraps it:

```
importId = randomUUID()
emit(import.started, { importId, archive, startedAt, correlationId })
try {
  result = await processArchive(filePath, importId)
  emit(import.completed, { importId, archive, ...result, correlationId })
} catch (error) {
  emit(import.failed, { importId, archive, reason, correlationId })
  throw
}
```

`emit` (not `send`) — fire-and-forget, no reply expected. Payload is metadata only
(counts, ids, timestamps) — never event data, per the assignment's explicit constraint.

## Service-a: RedisTimeSeries metrics (Phase 5)

At startup, idempotently `TS.CREATE` each metric key (ignoring "already exists" errors),
each with a retention policy (e.g. 7 days) so Redis-side memory is self-bounding
regardless of how long the demo runs:

```
service_a.api.requests / .success / .errors
service_a.archive.download.duration
service_a.archive.processing.duration
service_a.archive.events.processed / .invalid
service_a.archive.processing.errors
```

`TS.ADD` calls happen inline at the natural point in the orchestration (after each batch
write, after the pipeline finishes, on each API request) via `ioredis`'s `.call(...)` —
no metric value is ever accumulated in application memory before being written. A metrics
failure (Redis unavailable) is logged and swallowed, never allowed to fail the primary
import — matching the assignment's explicit instruction that metrics failures shouldn't
break business operations unless justified (there's no justification here).

## Service-b: RabbitMQ consumer & processing-log storage (Phase 6)

Three separate `@EventPattern` handlers — `github.import.started`, `github.import.completed`,
`github.import.failed` (plain patterns bound to the default direct exchange, matching this
repo's existing `service_a_queue`/`service_b_queue` naming convention — no topic exchange
needed for three fixed, known event names) — each validate the incoming message (Zod,
using the shared contract types from Phase 0), then upsert a
`processing-logs` document keyed by `{ importId, status }` (unique index — makes
redelivery a no-op instead of a duplicate) inside a single Mongo write, and only then
manually ack the message. On a write failure, the message is nacked and requeued; after a
bounded retry count (tracked via a header or a dead-letter exchange with
`x-death` inspection — exact mechanism decided at Phase 6 implementation time) it goes to
a dead-letter queue instead of retrying forever. Consumer concurrency is bounded via
`@nestjs/microservices`'s RMQ `prefetchCount` (config, default a small number like 10) —
never unbounded parallel message handling.

Stored log fields: `eventType` (which lifecycle event), `service: 'service-a'`,
`timestamp`, `correlationId`, `importId`, `archive`, `status`, `metadata` (the small
counters from the event), `errorInfo?` (for `.failed`). No large payloads.

## Service-b: log query API (Phase 7)

`GET /v1/logs?importId=...&status=...&from=...&to=...&cursor=...` — same cursor-pagination
shape as the search API, same "filter and sort entirely in MongoDB" rule, same indexes
pattern (`{importId:1, timestamp:-1}`, `{status:1, timestamp:-1}`, default
`{timestamp:-1, _id:-1}`).

## Service-b: processing statistics API (Phase 8)

`GET /v1/stats?importId=...` (or aggregate across all imports if omitted) — computed via
a MongoDB aggregation pipeline over `processing-logs` (group by status, sum counters) plus
optional `TS.RANGE` reads from RedisTimeSeries for time-bucketed charts. Never fetches raw
historical logs into Node to compute this by hand.

## Service-b: PDF report generation (Phase 9)

`GET /v1/reports/pdf?importId=...`. Orchestration: gather the stats (Phase 8's
aggregation), gather **downsampled** time-series data (`TS.RANGE ... AGGREGATION avg
<bucket-ms>`, capped at ~50 points, or an equivalent Mongo `$group`-by-time-bucket if
RedisTimeSeries doesn't have enough history for a given import), then build the PDF with
**pdfkit**, streamed directly to a file on the `report-storage` shared volume via
`doc.pipe(createWriteStream(path))` — never fully buffered in a `Buffer`/string. Charts
(events processed over time, events by type, success/failure) are drawn with pdfkit's
vector primitives against the already-small downsampled arrays, so chart-drawing code
never iterates a large series. Once the file is flushed, service-b replies to the
triggering RMQ message with `{ reportPath }`; the gateway streams that file back to the
HTTP client (`createReadStream(reportPath).pipe(res)`) and the file is cleaned up
afterward.

**Library choice**: `pdfkit` over Puppeteer/HTML-to-PDF (headless Chromium per report is
a much heavier memory/CPU footprint, hard to justify under the memory-safety requirement)
and over `chartjs-node-canvas` (adds a native `canvas` dependency — heavier Docker image,
more that can go wrong, for charts simple enough to hand-draw with pdfkit's own vector API
at this scope).

## API Gateway (Phase 10)

Routes for: trigger download-import, upload-import, get import status, search events, get
logs, get stats, get PDF report — all `/v1/...`, all validated with DTOs + Swagger
decorators, all pure HTTP-concern translation (no business logic, no Mongo/Redis access —
`CLAUDE.md`'s existing gateway rule, unchanged). `Idempotency-Key` header support on the
two import-trigger endpoints (so a retried "start this import" request doesn't start it
twice) — implemented as a small check against the `imports` collection's `importId` if the
client supplies one, otherwise the gateway generates one.

## Frontend (Phase 10)

Minimal Angular pages: trigger a download-import (date/hour picker) or upload a file;
view import status/counters (polling the status endpoint); search events with the filter
fields from Phase 4; view processing logs; view stats; download the PDF report. No design
investment beyond making every backend capability reachable and legible.

## Error handling summary

| Failure | Behavior |
|---|---|
| GH Archive HTTP error / network failure / timeout | Temp file cleaned up, `AppError` thrown, `import.failed` emitted, no partial file left looking complete. |
| Malformed NDJSON line / failed validation | Counted, truncated sample logged, processing continues. |
| Duplicate `eventId` on insert | Counted separately from errors, processing continues (idempotent re-import). |
| MongoDB write failure (batch) | Propagates as a processing error — importId's `imports` doc and `import.failed` event carry the reason; already-inserted batches are not rolled back (each batch is its own atomic bulk write, not one giant transaction — a deliberate trade-off given the assignment's memory/streaming constraints; see "Out of scope"). |
| RabbitMQ message redelivered | No-op via unique `{importId, status}` index in service-b. |
| Service-b unavailable | Service-a's `emit` doesn't block/fail (RabbitMQ queues the message); once service-b returns, it drains the backlog under its bounded `prefetchCount`. |
| Redis (metrics) unavailable | Logged and swallowed — never fails the primary import/API operation. |

## Testing strategy

Matches this repo's existing conventions (verified against `skills/testing-development.md`):
unit tests (`*.spec.ts`) for every pure step function (URL building, line splitting,
validation, transform, batching, cursor-pagination math, stats aggregation shaping);
`.int.spec.ts`/`.spec.ts` for controllers and RMQ handlers with **mocked** Mongo/Redis/
RabbitMQ clients (this repo's testing convention prohibits live external services /
Testcontainers in the automated suite — confirmed, not assumed). Coverage thresholds
match the existing 90%/90% lines/branches config.

## Memory-safety demonstration

Deliberately **not** part of the automated (mocked) test suite above — it needs a real
large file and a real MongoDB. A separate script, `pnpm --filter service-a run
bench:memory`, runs the real `downloadArchive`/`processArchive` pipeline against a running
`docker compose` stack, sampling `process.memoryUsage().rss` on an interval and printing
it alongside bytes-read-so-far, so memory can be observed staying flat as the archive is
consumed. Documented in the README as something you run and read, not something CI asserts
on a threshold for (thresholds on RSS are flaky across machines/Node versions).

## Out of scope / trade-offs

- **No gRPC.** The assignment lists it as an optional bonus; skipped in this cycle to keep
  scope proportionate to an interview take-home. The shared-volume + RMQ-trigger design
  for the PDF path works without it and can be swapped for gRPC later without touching the
  processing/report-generation logic.
- **No cross-batch transaction for the whole import.** Each Mongo batch insert is its own
  atomic bulk write; a failure partway through an archive leaves earlier batches inserted.
  Wrapping the entire streamed import in one multi-document transaction would require
  holding a session open for the whole file and defeats the point of bounded, incremental
  processing — the `imports` collection's counters plus idempotent re-import (unique
  `eventId` index) make a failed run safely resumable/re-runnable instead.
- **No unlimited filter-combination indexing** on `events`/`processing-logs` — one index
  per common single-filter pattern, documented above, not one per possible combination.
- **No auth.** Consistent with the rest of this codebase today (no auth exists anywhere
  yet) — out of scope for this feature too.
- **No Repository pattern, no CQRS/event sourcing, no caching layer beyond
  RedisTimeSeries** — per `CLAUDE.md`'s forbidden-without-approval list; none of this
  feature's requirements need them.
