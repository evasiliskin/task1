# task1

pnpm workspace monorepo: NestJS microservices back-end.

```
task1/
└── back-end/
    ├── api-gateway/         Public HTTP entrypoint - REST API, forwards to microservices over RabbitMQ
    ├── service-a/           Internal microservice (RabbitMQ transport only, no HTTP)
    ├── service-b/           Internal microservice (RabbitMQ transport only, no HTTP)
    └── libs/shared/         Shared library (@task1/shared) - errors, exception handling,
                              API response envelopes, pagination, request-context/correlation-ID
                              propagation, logging, GH Archive contracts
```

## Contents

- Architecture
- API reference
  - Response format
- Authentication
- Health checks
- Getting started
- Common tasks
- Tooling notes
- GitHub Archive Import & Analytics
- Correlation ID & Request ID
- Known limitations

## Architecture

The gateway is the only HTTP surface. It receives REST requests, validates them, and forwards to
the internal microservices over NestJS's RabbitMQ transport — request/reply RPC (`ClientProxy.send`
/ `@MessagePattern`) for queries, fire-and-forget commands and lifecycle events (`ClientProxy.emit`
/ `@EventPattern`) for imports and cross-service notifications. `service-a` and `service-b` expose
no HTTP at all — they're reachable only as RabbitMQ consumers.

```
Client
      │  HTTP (REST)
      ▼
   gateway  ──RabbitMQ──▶  service-a  ──RabbitMQ──▶  service-b
```

Every request through this chain carries a `correlationId` (stable for the whole flow) and a
`requestId` (fresh per hop) — see "Correlation ID & Request ID" below.

## API reference

All routes are served under a global `/api/v1` prefix (set in
`back-end/api-gateway/src/main.ts`) with interactive Swagger docs at `/api-docs`. Full
request/response DTOs live under each module's `dto/` folder; this table is the map, not the spec.

### Response format

Every JSON response is enveloped. `GET /reports/{importId}` is the one exception: it streams a
PDF and is returned unwrapped.

Success (single resource):

```json
{
  "status": "SUCCESS",
  "code": 200,
  "message": "OK",
  "result": { "data": { ... } },
  "meta": { "tracing": { "correlationId": "2f1fdc5d-4324-4f56-95ae-d25df842bd7b" } }
}
```

Success (collection):

```json
{
  "status": "SUCCESS",
  "code": 200,
  "message": "OK",
  "result": {
    "items": [ ... ],
    "pagination": { "nextCursor": "..." }
  },
  "meta": { "tracing": { "correlationId": "2f1fdc5d-4324-4f56-95ae-d25df842bd7b" } }
}
```

Error:

```json
{
  "status": "FAILED",
  "code": 400,
  "reason": "REQUEST_CONTRACT_VIOLATION",
  "message": "Request validation failed",
  "details": {
    "checksFailed": [
      { "field": "limit", "errorType": "TOO_BIG", "message": "...", "constraints": { "max": 200 } }
    ]
  },
  "meta": { "tracing": { "correlationId": "2f1fdc5d-4324-4f56-95ae-d25df842bd7b" } }
}
```

- `"reason"` is the `AppError` code.
- `"details"` is present only for field-level validation failures.
- All 5xx responses are sanitized to reason `"INTERNAL_ERROR"` with a generic message; the real
  error is logged server-side against the `correlationId`.
- `"requestId"` is not part of any response body. Both ids remain available as the
  `x-correlation-id` and `x-request-id` response headers.

`GET /health/ready` returns `"status": "SUCCESS"` with `"code": 503` when degraded: the handler
completes normally and sets the status code, so no error envelope is produced.

| Method | Path | Purpose | Auth | RabbitMQ pattern → service |
| --- | --- | --- | --- | --- |
| `GET` | `/api/v1/health` | Aggregated health of gateway + all dependencies | Public | — |
| `GET` | `/api/v1/health/live` | Liveness probe (process is running) | Public | — |
| `GET` | `/api/v1/health/ready` | Readiness probe (`503` if RabbitMQ/service-a/service-b down) | Public | — |
| `POST` | `/api/v1/imports` | Trigger a download import for one GH Archive hour (`Idempotency-Key` header supported). `503` if the broker rejects the publish | Required | `archive.import.download` → service-a |
| `POST` | `/api/v1/imports/upload` | Upload a `.json.gz` archive file to import (multipart, max 512 MiB, gzip magic bytes verified). `503` if the broker rejects the publish | Required | `archive.process.upload` → service-a |
| `GET` | `/api/v1/imports/:importId` | Get one import run's status/counters | Required | `imports.status.get` → service-a |
| `GET` | `/api/v1/events` | Search imported GitHub events, cursor pagination | Required | `events.search` → service-a |
| `GET` | `/api/v1/logs` | Search processing-log entries, cursor pagination | Required | `logs.search` → service-b |
| `GET` | `/api/v1/stats` | Processing statistics, optionally scoped to one import | Required | `stats.get` → service-b |
| `GET` | `/api/v1/reports/pdf` | Generate and stream a PDF processing report | Required | `reports.pdf.generate` → service-b |

See "GitHub Archive Import & Analytics" below for the data flow behind the imports/events/logs/
stats/reports endpoints, and "Authentication" for what "Required" currently means in practice.

## Authentication

Every endpoint above requires authentication except the three `/health*` routes, which are marked
`@Public()` (`back-end/api-gateway/src/health/health.controller.ts`).
Enforcement is one global guard, `AuthGuard`
(`back-end/api-gateway/src/auth/auth.guard.ts`), wired in via `APP_GUARD` in
`AuthModule`.

**Current state — intentional placeholder.** `AuthGuard` has no real credential-verification logic
yet; its `isAuthenticated()` unconditionally returns `true`, so every request that reaches it is
currently allowed through. This is deliberate — see the code comment in `auth.guard.ts`, which
documents it as a temporary placeholder — the seam (`canActivate`, the `@Public()` override, the
`isAuthenticated` method) is in place so a real provider (Auth0, Passport.js, JWT/OIDC, etc.) can
be dropped in behind it later, populating `request.user` (`authenticated-user.interface.ts`).
Until then:

- Every endpoint, including the ones documented as "Required" above, currently responds normally
  (its usual 2xx status) with no credentials supplied — authentication is not yet enforced.
- Integration tests still override the guard (`.overrideProvider(AuthGuard).useValue({
  canActivate: () => true })`) to exercise the endpoints they target, independent of this
  placeholder behavior — follow the same pattern in new `*.controller.int.spec.ts` files.
- The curl examples in this README (below) describe the intended request/response shape once real
  auth is wired in; running them as-is against an unmodified checkout currently succeeds without
  credentials rather than returning `401`/`403`.

## Rate limiting

Every gateway endpoint except `/health*` is rate-limited via `@nestjs/throttler`, registered as a
global `APP_GUARD` in `back-end/api-gateway/src/app.module.ts` — positioned before `AuthModule`'s
own `APP_GUARD` so a request is throttled before it reaches the (currently allow-all) auth check.

- Default limit: 100 requests / 60,000 ms per client, configurable via `THROTTLE_LIMIT` /
  `THROTTLE_TTL_MS`.
- `POST /api/v1/imports/upload` has a tighter limit — 5 requests / 60,000 ms
  (`@Throttle({ default: { limit: 5, ttl: 60_000 } })` on `UploadImportController.upload`,
  matching `THROTTLE_UPLOAD_LIMIT`'s default) — since uploads are the most expensive request the
  gateway accepts.
- `/health`, `/health/live`, and `/health/ready` are exempted (`@SkipThrottle()` on
  `HealthController`) so orchestrator liveness/readiness probes never trip the limit.
- An exhausted limit returns `429 Too Many Requests` and never reaches the controller handler.

**Storage is Redis-backed, not the library's default in-memory store**, via
`ThrottlerStorageRedisService` from `@nest-lab/throttler-storage-redis`. In-memory storage would
track hit counts per gateway process — with more than one gateway replica behind a load balancer,
each replica would enforce the limit independently, letting a client exceed the intended aggregate
limit by a multiple of the replica count. Redis-backed storage shares one counter across every
replica, so the limit holds regardless of how many gateway instances are running.

The `ThrottlerStorageRedisService` is constructed from the gateway's existing shared `ioredis`
client (`REDIS_CLIENT`, provided by `HealthModule` and already used by `RedisHealthIndicator`) —
`new ThrottlerStorageRedisService(redisClient)` — rather than opening a second Redis connection
with its own connection options. The gateway maintains exactly one Redis connection.

## Health checks

The gateway exposes three endpoints under `/health` (`GET /health`, `/health/live`, `/health/ready`
— see the API reference above for the exact paths).

**Liveness vs readiness.** Liveness answers "is the process alive" — a process manager (or
Docker's own `HEALTHCHECK`) uses this to decide whether to restart the container. It never calls
out to anything, because a slow dependency should never cause a healthy process to be killed and
restarted. Readiness answers "can this process currently do its job" — it's what should gate
traffic. A gateway with a dead RabbitMQ connection is alive but not ready: restarting it would not
help, but it also shouldn't receive requests it cannot fulfill.

**Critical vs informational dependencies.** `/health/ready` treats RabbitMQ, service-a, and
service-b as critical — the gateway's only purpose is routing requests to those services through
the broker, so if any of them is unreachable, `/health/ready` returns `503`. Redis is
reported for visibility but is informational only — nothing in the gateway's request path uses
it today (there is no persistence layer or caching configured), so its failure never causes
`/health/ready` to fail.

**Why the gateway never accesses service-a/b's databases directly.** The gateway has no visibility
into, or dependency on, service-a/b's internal storage. Checking their databases directly would
violate the module boundary (each service owns its own persistence) and would report "healthy"
even if the service's own RabbitMQ consumer had crashed — the opposite of what a caller needs to
know. Instead, the gateway sends a dedicated `health.check` RabbitMQ message to each service and
waits (with a timeout) for a reply — the same transport and pattern used for every other
inter-service call, exercising the actual path a real request would take.

Example — `GET /health`, everything healthy (see "Response format" above for the envelope shape):

```json
{
  "status": "SUCCESS",
  "code": 200,
  "message": "OK",
  "result": {
    "data": {
      "status": "ok",
      "services": {
        "gateway": "ok",
        "rabbitmq": "ok",
        "serviceA": "ok",
        "serviceB": "ok",
        "redis": "ok"
      }
    }
  },
  "meta": { "tracing": { "correlationId": "2f1fdc5d-4324-4f56-95ae-d25df842bd7b" } }
}
```

## Getting started

Node version is pinned in `.nvmrc` (kept in sync with `engines.node` in
`package.json` and the Docker images). Switch to it before installing:

```bash
nvm use

pnpm install

# start RabbitMQ + service-a + service-b + gateway
pnpm docker:up

# or run services individually against a local RabbitMQ/MongoDB/Redis:
cp back-end/api-gateway/.env.example back-end/api-gateway/.env
cp back-end/service-a/.env.example back-end/service-a/.env
cp back-end/service-b/.env.example back-end/service-b/.env

pnpm dev:service-b
pnpm dev:service-a
pnpm dev:api-gateway
```

**`.env` files are not auto-loaded.** Each service's `ConfigModule.forRoot({ ignoreEnvFile: true,
... })` deliberately does *not* read `.env` — copying `.env.example` to `.env` is a reference/template
step only. To change a value from its built-in default (see each service's `config/*.config.ts`),
export it into the shell's actual environment before running `pnpm dev:*` (or use a tool like
`dotenv-cli`), rather than editing `.env` and expecting it to take effect.

- Gateway REST API: http://localhost:3000/api/v1 — see "API reference" above for the full
  endpoint list (health checks at `/api/v1/health`, `/health/live`, `/health/ready`)
- Gateway Swagger docs: http://localhost:3000/api-docs
- RabbitMQ management UI: http://localhost:15672 (guest/guest)
- `service-a`/`service-b`: internal only, reachable over RabbitMQ (not exposed to the browser)
- MongoDB: owned by `service-a` (`service_a`) and `service-b` (`service_b`) — service-a persists
  imported GitHub events and import-run tracking, service-b persists processing-log entries (see
  "MongoDB indexes" below); the gateway does not use MongoDB at all — it has no database of its
  own and no MongoDB health check
- Redis: service-a records pipeline metrics via RedisTimeSeries (see "RedisTimeSeries metrics"
  below); the gateway only pings it for health checks, no caching is implemented against it
- to point the gateway at a non-default `REDIS_URL` when running outside Docker, export it into
  the shell environment before `pnpm dev:api-gateway` (see the `.env` note above)

## Common tasks

| Command | What it does |
| --- | --- |
| `pnpm build` | Build every workspace package |
| `pnpm test` | Run every workspace package's tests (Vitest — `api-gateway`, `service-a`, `service-b`, `libs/shared`) |
| `pnpm lint` | Lint every workspace package (ESLint) |
| `pnpm format` / `pnpm format:check` | Prettier across the whole workspace |
| `pnpm check` | `lint` + `test` - also runs automatically on `git push` (Husky) |
| `pnpm docker:up` / `pnpm docker:down` | Start/stop RabbitMQ, MongoDB, Redis, and all three back-end services |
| `pnpm --filter <package> run <script>` | Run one package's script directly, e.g. `pnpm --filter api-gateway run test:cov` |

## Tooling notes

- **Package manager**: pnpm workspaces (`pnpm-workspace.yaml`: `back-end/*`, `back-end/libs/*`).
- **Testing**: Vitest for all four packages (`*.spec.ts` unit tests everywhere, `*.controller.int.spec.ts`
  HTTP-integration tests for the gateway's 8 controllers via `supertest`; `service-a`/`service-b`
  have no HTTP layer so are unit-tested only). Each package's `vitest.config.mts` enforces 90%
  line/branch coverage thresholds.
- **Prettier**: one shared config at the repo root (`.prettierrc.mjs`), applies to every package.
- **ESLint**: `back-end/api-gateway`, `back-end/service-a`, and `back-end/service-b` each have their
  own `eslint.config.mjs` (typescript-eslint + import ordering + security/sonarjs/unicorn rules),
  pointed at each app's own `tsconfig.json`.
- **Git hooks**: Husky runs `pnpm check` (lint + test) on `git push`, not on every commit -
  `.husky/pre-push`. Hooks install automatically the first time you run `pnpm install` (the root
  `prepare` script).
- **No general persistence layer** - there is no ORM, Repository pattern, or shared database
  abstraction. The only persistence is the GH Archive pipeline's own MongoDB collections, owned
  directly by the module that writes them (see "MongoDB indexes" below); the gateway itself
  persists nothing. A general-purpose persistence layer will be added once a concrete need is
  decided (see `CLAUDE.md`).

## GitHub Archive Import & Analytics

A memory-safe pipeline that downloads or accepts an uploaded [GH Archive](https://www.gharchive.org/)
hourly `.json.gz` file (one hour of every public GitHub event, as newline-delimited JSON once
decompressed), imports it into MongoDB, and exposes search/stats/PDF-report endpoints over the
gateway's REST API. Full design: `docs/superpowers/specs/2026-08-12-github-archive-platform-design.md`
(this path is `.gitignore`d — not committed to this repo, so the link only resolves for someone
with that file locally).

### Data flow

```
Client --HTTP--> gateway --RabbitMQ emit--> service-a --gunzip/parse/validate--> MongoDB (events)
                                                |
                                                +--RabbitMQ emit (lifecycle events)--> service-b
                                                                                          |
                                                                                MongoDB (processing-logs)
                                                                                          |
                                                                          RedisTimeSeries (metrics)
```

The trigger itself (`POST /imports`, `POST /imports/upload`) publishes a RabbitMQ `emit`, but the
gateway now **awaits** that publish before responding: it returns `202`/`201` once service-a has
accepted the command (not once the import finishes — poll `GET /imports/:importId`, RabbitMQ RPC,
for status), or `503` if the broker rejects the publish (e.g. a queue-declaration mismatch on
connect). `GET /events`, `GET /logs`, `GET /stats`, and `GET /reports/pdf` are RabbitMQ RPC
(`.send`) — the gateway blocks until the downstream service replies.

`service-a` and `service-b` serve no HTTP traffic — reachable only through the gateway, over
RabbitMQ. `service-a` does construct a Nest HTTP adapter internally (`NestFactory.create` with
`@nestjs/platform-express`), but purely as an implementation detail of running two RMQ listeners in
one process via `connectMicroservice`/`startAllMicroservices` — it never opens an HTTP port or
listens for HTTP traffic.
Uploaded archives and generated PDF reports move as file bytes over Docker-Compose-managed shared
volumes (`archive-storage`, `report-storage`), never through RabbitMQ or an application `Buffer` —
only a small `{importId, filePath}`-shaped message crosses the broker for either.

### Memory safety

The pipeline never buffers a whole archive in memory: `response.arrayBuffer()`/`.text()` and
manual chunk-array accumulation are never used anywhere in the download or processing path.
Downloading is one `stream.pipeline(httpResponseStream, createWriteStream(...))` call — memory use
is bounded by internal stream buffer sizes, independent of archive size. Processing composes
`createReadStream(filePath).compose(createGunzip())` into a chain of async generators (line
splitting keeps only the current trailing partial line in memory; validation/transform process one
event at a time; batching yields arrays capped at `MONGO_BATCH_SIZE`, default 500) feeding a Mongo
`bulkWrite` per batch. Each batch write is awaited before the next batch is pulled — that's what
makes backpressure work: the pipeline cannot outrun MongoDB, and RSS stays flat regardless of how
large the source archive is.

This property is enforced structurally (streams and async generators end to end, no full-archive
buffer anywhere in `back-end/service-a/src/archive/`) rather than by an automated assertion: the
test suite mocks the network and MongoDB, and there is no RSS threshold check anywhere — such
thresholds are flaky across machines and Node versions. To observe it on a real archive, run an
import against the Docker stack and watch the container's memory while it works:

```bash
pnpm docker:up
curl -s -X POST http://localhost:3000/api/v1/imports -H 'Content-Type: application/json' \
  -d '{"dateHour": "2026-08-11-0"}'
docker stats task1-service-a
```

Expected: `MEM USAGE` stays roughly flat for the whole download-and-insert run instead of growing
with the size of the archive being consumed.

### Pagination

Every list endpoint (`GET /events`, `GET /logs`) uses keyset (cursor) pagination —
`{createdAt/timestamp, eventId/_id}` — never `skip()`. Each response includes `nextCursor`
(absent once exhausted); pass it back as the next request's `cursor` query param.

### MongoDB indexes

`events` (owned by `service-a`): `{eventId:1}` unique (idempotency + dedup),
`{createdAt:-1, eventId:-1}` (default pagination), plus one compound index per common
single-filter access pattern — `{eventType:1, createdAt:-1}`, `{'repo.name':1, createdAt:-1}`,
`{'actor.login':1, createdAt:-1}`. `imports` (owned by `service-a`): `{importId:1}` unique — one
document per import run, tracking status/counters/error samples. `processing-logs` (owned by
`service-b`):
`{importId:1, status:1}` unique (makes RabbitMQ redelivery a no-op), `{timestamp:-1, _id:-1}`
(default pagination), `{importId:1, timestamp:-1}`, `{status:1, timestamp:-1}`. Each service only
ever queries its own collections — cross-service Mongo access never happens.

### RabbitMQ event flow

`service-a` wraps every import (download- or upload-triggered) with three fire-and-forget
lifecycle events — `github.import.started`, `.completed`, `.failed` — carrying metadata only
(counts, ids, timestamps; never event payloads). `service-b` consumes all three idempotently
(unique `{importId, status}` index makes redelivery a no-op) into its own `processing-logs`
collection. On a write failure it always acks the original message, then manually re-publishes it
to the same queue with an incremented retry-count header (up to `RABBITMQ_MAX_RETRIES`, default 5)
or, once that's exhausted, to the dead-letter queue (`service_b_queue.dlq`) — a deliberate
application-level retry rather than RabbitMQ's own nack/requeue. A message that fails schema
validation is acked and dropped (logged, never retried) since redelivery can't fix a malformed
payload. Consumer concurrency is bounded via `prefetchCount` — never unbounded parallel handling.

### RedisTimeSeries metrics

`service-a` records `service_a.archive.download.duration`,
`service_a.archive.processing.duration`, `service_a.archive.events.processed/.invalid`, and
`service_a.archive.processing.errors` via
`TS.ADD`, inline at the natural point in the orchestration — no metric value is ever accumulated
in application memory first. Every metric key has a retention policy (7 days), so Redis-side
memory is self-bounding. A Redis failure is logged and swallowed, never allowed to fail the
primary import.

### Trying it end-to-end

There is no frontend — every capability is reachable via `curl` or the gateway's Swagger UI
(`http://localhost:3000/api-docs`). All routes below other than `/health*` are declared as
requiring authentication, but the current `AuthGuard` stub lets every request through (see
"Authentication" above), so this flow runs end-to-end on an unmodified checkout with no
credentials:

```bash
pnpm docker:up

# trigger a download import for a real GH Archive hour
curl -s -X POST http://localhost:3000/api/v1/imports -H 'Content-Type: application/json' \
  -d '{"dateHour": "2026-08-11-0"}'
# => {"status":"SUCCESS","code":201,"message":"OK","result":{"data":{"importId":"..."}},"meta":{"tracing":{"correlationId":"..."}}}

# poll status until it reaches "completed"
curl -s http://localhost:3000/api/v1/imports/<importId>

# search the imported events
curl -s 'http://localhost:3000/api/v1/events?type=PushEvent&limit=10'

# view processing logs and stats
curl -s http://localhost:3000/api/v1/logs
curl -s http://localhost:3000/api/v1/stats

# download the PDF report (omit importId for an aggregate report across all imports)
curl -s 'http://localhost:3000/api/v1/reports/pdf?importId=<importId>' -o report.pdf
```

`GET /stats` response (see "Response format" above for the envelope shape):

```json
{
  "status": "SUCCESS",
  "code": 200,
  "message": "OK",
  "result": {
    "data": {
      "archivesProcessed": 12,
      "eventsProcessed": 48000,
      "successfulEvents": 47500,
      "invalidEvents": 500,
      "errors": 3,
      "processingDurationMs": 15230,
      "timeSeries": [{ "timestamp": "2026-08-11T00:00:00.000Z", "value": 100 }],
      "degraded": false
    }
  },
  "meta": { "tracing": { "correlationId": "2f1fdc5d-4324-4f56-95ae-d25df842bd7b" } }
}
```

`degraded` is `true` when MongoDB or Redis was unreachable while computing the statistics — the
numeric fields fall back to zeros (or omit `processingDurationMs`/return an empty `timeSeries`) in
that case rather than the request failing, so `degraded` is what distinguishes "zero because no
imports have run yet" from "zero because a data source was down". It is optional on the response
schema and only present in service-b's payload when set, so existing clients that ignore unknown
fields are unaffected. The PDF report (`GET /reports/pdf`) prints a corresponding warning line in
its summary section when the underlying stats were degraded.

### Trade-offs

No gRPC, no cross-batch transaction spanning a whole import, no unlimited filter-combination
indexing, no auth, no Repository/CQRS/event-sourcing/extra-caching layer — all deliberate, all
explained in the design doc's own "Out of scope / trade-offs" section rather than duplicated here
(`docs/superpowers/specs/2026-08-12-github-archive-platform-design.md#out-of-scope--trade-offs` —
`docs/` is `.gitignore`d and not committed, so this link only resolves locally, not from a fresh
clone).

### Upgrading to the split import topology

The AB1 gateway-imports-queue split (`service_a_imports_queue`) and the DLQ/retry rework changed
the declared arguments of three existing durable queues. RabbitMQ treats a queue's arguments as
part of its identity: redeclaring an existing queue with different arguments doesn't update it, it
fails with `PRECONDITION_FAILED` (406) and the failing side's channel closes. Before first deploy
of this change, drain and delete these queues so they get recreated with the new arguments:

- `service_a_queue` — gains dead-letter arguments (`x-dead-letter-exchange`,
  `x-dead-letter-routing-key`) for the first time, declared in `back-end/service-a/src/main.ts`.
- `service_b_queue` — same, declared in `back-end/service-b/src/main.ts`.
- `service_b_queue.retry` — previously carried a fixed `x-message-ttl`; the new
  `buildRetryQueueArguments` (`back-end/libs/shared/src/messaging/queue-topology.ts`) omits it in
  favor of a per-message `expiration` set at publish time. If this queue isn't drained/deleted, the
  OLD fixed-TTL queue silently stays in place — retries would still work, but the backoff timing
  fix would be inert without any error surfaced.

```bash
rabbitmqctl list_queues name messages
rabbitmqctl delete_queue service_a_queue
rabbitmqctl delete_queue service_b_queue
rabbitmqctl delete_queue service_b_queue.retry
```

**Deploy order:** bring up `service-a` first and let it start consuming
`service_a_imports_queue` before starting/redeploying the gateway — the gateway's RMQ clients
publish to that queue with `noAssert: true` (they don't declare it), so if nothing has declared it
yet, published messages have nowhere durable to land.

**Watch for this failure mode:** `QueueTopologyInitializer` treats a queue-declaration failure as
non-fatal and only logs a `warn`-level line, not an error, so an argument mismatch on redeclare is
easy to miss in logs during an upgrade — grep service-a/service-b startup logs for that warning
after deploying.

**One-off cleanup — legacy `.tmp` files:** before this phase, uploaded/downloaded archives in
`service-a`'s storage directory used a bare `.tmp` suffix; this phase split that into
`.upload.tmp`/`.download.tmp` so the sweeper can tell an in-progress upload apart from an
in-progress download. The sweeper only matches the new suffixes, so any bare-`.tmp` file left over
from before the upgrade will never be cleaned up on its own. Run this once after deploying, to
clear out that pre-existing backlog:

```bash
docker compose exec service-a sh -c 'find /data/archives -maxdepth 1 -name "*.tmp" ! -name "*.upload.tmp" ! -name "*.download.tmp" -mmin +60 -delete'
```

## Correlation ID & Request ID

Every request that flows through `gateway → service-a → service-b` carries two identifiers:

- **`correlationId`** identifies the entire logical request/business flow. It is generated once,
  at the point the flow enters the system (the gateway's HTTP layer), and stays **identical**
  across every service that participates in handling that request.
- **`requestId`** identifies one specific hop — one service-to-service call. Every outbound call
  (gateway→service-a, service-a→service-b) mints a **fresh** `requestId`, so a single
  `correlationId` is associated with several different `requestId`s, one per hop.

```
                         correlationId = C1
                                |
                                v
Client ────────> Gateway ─────> service-a ─────> service-b
  X-Correlation-ID: C1
  X-Request-ID: R1          R1              R2                R3
                             |               |                 |
                             +---------------+-----------------+
                                    same correlationId, C1
                            each hop mints its own fresh requestId
```

**Generation.** If the client sends `X-Correlation-ID` / `X-Request-ID` HTTP headers to the
gateway, their values are reused (after validation — see below); otherwise the gateway generates a
UUID v4 for each via Node's built-in `crypto.randomUUID()`. Every outbound RabbitMQ call generates
a brand-new `requestId` the same way, regardless of what the current service's own `requestId` is.

**Validation.** Any incoming ID (HTTP header or RabbitMQ message header) is trimmed, and rejected
(silently replaced with a freshly generated UUID v4) if it's empty, over 200 characters, or
contains anything other than printable ASCII — this blocks header/log injection via a spoofed ID
without requiring every caller's correlation ID to itself be a UUID.

**Propagation.** IDs travel only as transport-level metadata, never inside a business
payload/DTO: HTTP request/response headers (`X-Correlation-ID`, `X-Request-ID`) between the client
and the gateway, and RabbitMQ message headers (via `RmqRecordBuilder`) between the gateway,
service-a, and service-b. Each service reads the incoming IDs (via HTTP middleware in the gateway,
via a global RabbitMQ interceptor in service-a/service-b), stores them in an `AsyncLocalStorage`-based
request context (`back-end/libs/shared/src/request-context/`, shared by all three services via
`@task1/shared` — see the design doc referenced below), and makes them available to every
controller, service, and log line for the duration of that request with no manual parameter
threading. On RabbitMQ, `correlationId` is carried **only** on the `x-correlation-id` AMQP header —
it is deliberately not duplicated inside `import.*` event payloads (`ImportStartedEvent`,
`ImportCompletedEvent`, `ImportFailedEvent`, etc.). Every outbound `ClientProxy.emit`/`.send` must
go through `ContextPropagatingClient`
(`back-end/libs/shared/src/request-context/rmq/context-propagating.client.ts`), which stamps the
header from the current request context; calling a raw `ClientProxy` instead silently drops the
header, and the next consumer mints a fresh id, breaking the trace chain at that hop.

**`correlationIdSource`.** Every log line also carries `correlationIdSource`, either `"inbound"`
(the id came from an incoming `X-Correlation-ID` header or `x-correlation-id` AMQP header and
passed validation) or `"generated"` (no id was supplied, *or* one was supplied but rejected by
validation — see "Validation" above — so one was minted locally). On the `rmq` channel
specifically, `correlationIdSource: "generated"` is the signal that a hop lost the incoming id —
it means some publish site emitted without going through `ContextPropagatingClient`, or a
downstream service sent a malformed id. There should be no `"generated"` values on the `rmq`
channel in normal operation; any occurrence is a propagation bug at that publish site.

Background sweeps that run outside of any inbound request (e.g. `service-b`'s `report-sweep`,
`service-a`'s `archive-storage-sweep` — see `RequestContextService.runAsRoot`) mint their own root
context and add an `operation` field (e.g. `"report-sweep"`) so every line one sweep emits can be
grouped and followed, even though there is no client request behind it.

**In logs.** Every service logs through a small `LoggerService`/`AppLogger` wrapper over
`pino` (`back-end/libs/shared/src/logger/`, shared by all three services). Both `correlationId` and `requestId` are merged into
every log line automatically via pino's `mixin` option, which reads the active request context —
nothing needs to explicitly pass either ID to a log call. The shared `correlationId` lets you
reconstruct the whole flow across all three services' logs, while each service's own `requestId`
identifies exactly which hop each log line belongs to.

Every line also carries three fixed fields that say where it came from: `service` (the emitting
service, from the `SERVICE_NAME` environment variable — set in each Dockerfile, in
`docker-compose.yml` and in the `start*` scripts; required in production, falls back to
`unknown-service` elsewhere), `source` (the class that logged it) and `channel` (`http`, `rmq`, or
`bootstrap` for framework logs emitted before the app started listening — after that the framework
switches to the service's runtime channel).

A few more fields show up on specific lines rather than every line: `operation` on background-sweep
root contexts (see `correlationIdSource` above); `dependency` on the gateway's health-check
up/down/recovery lines (`back-end/api-gateway/src/health/health-check.service.ts`) — the name of
the checked dependency (`rabbitmq`, `serviceA`, `serviceB`, `redis`); `importSource` on
service-a's `import started` line — the archive source type (e.g. `download`); and, on lines
written by Nest's own framework logger (`source:"Nest"`, bridged via `NestLoggerBridge`),
`nestContext` (the Nest-supplied logging context, e.g. the module/class name) and `stack` (a
pre-formatted stack-trace string Nest hands in on `logger.error()`, not an `Error` object — it does
not go through the `err` serializer).

**HTTP request logging.** The gateway logs every request twice —
`HttpLoggingMiddleware` (`back-end/libs/shared/src/logger/http/http-logging.middleware.ts`) emits
`request started` when the request enters the pipeline and `request completed` when the response
finishes. One real `POST /imports?dryRun=false` (formatted here for readability, one JSON object
per line in reality):

```json
{"level":"info","pid":8488,"hostname":"...","service":"api-gateway",
 "correlationId":"62bfe171-...","requestId":"bf26a9ed-...",
 "request":{"method":"POST","url":"/imports?dryRun=false","path":"/imports",
            "query":{"dryRun":"false"},"body":{"dateHour":"2026-08-11-0"},
            "headers":{"host":"127.0.0.1:55251","idempotency-key":"a0eebc99-...",
                       "content-type":"application/json","content-length":"27"},
            "ip":"::ffff:127.0.0.1"},
 "source":"HttpLoggingMiddleware","channel":"http","msg":"request started"}

{"level":"info","pid":8488,"hostname":"...","service":"api-gateway",
 "correlationId":"62bfe171-...","requestId":"bf26a9ed-...",
 "method":"POST","url":"/imports?dryRun=false","statusCode":202,
 "contentLength":"192","durationMs":6,
 "source":"HttpLoggingMiddleware","channel":"http","msg":"request completed"}
```

Details:

- The start line carries the whole request: method, URL, path, query, parsed body, headers and
  client IP. Route parameters are not yet bound at middleware time — they are visible in `url`.
  Multipart uploads are parsed later, inside the route handler, so file payloads never reach the
  log.
- Completion level follows the status: `info` below 400, `warn` for 4xx, `error` for 5xx
  (a 5xx additionally produces `GlobalExceptionFilter`'s stack-trace line).
- Sensitive keys (`authorization`, `cookie`, `password*`, `token`, `apiKey`, `secret` — see
  `logger/redact-paths.ts`) are replaced with `[REDACTED]` at any depth of headers, query or body.
- Health probes (`/health`, `/health/live`, `/health/ready`) and the Swagger UI (`/api-docs`) are
  not logged at all — see `UNLOGGED_PATH_SEGMENTS` in the middleware.
- `pino-http`'s own automatic request logging is switched off, so each request produces exactly
  these two lines and no duplicates.

**Errors.** If any service in the chain fails, the error still carries the same IDs: the gateway's
HTTP error response includes both `X-Correlation-ID`/`X-Request-ID` response headers, and the error
envelope's `meta.tracing.correlationId` field (see "Response format" above) is sourced from the
same request context - not re-derived - so it always matches what was logged for that request.
`requestId` is not part of the response body; it's only available via the `x-request-id` header.

### Testing it locally

```bash
pnpm docker:up
```

Send a request with explicit IDs and see them echoed back:

```bash
curl -i http://localhost:3000/api/v1/health/ready \
  -H "X-Correlation-ID: 11111111-1111-4111-8111-111111111111" \
  -H "X-Request-ID: 22222222-2222-4222-8222-222222222222"
```

The response includes `x-correlation-id: 11111111-1111-4111-8111-111111111111` (echoed back
unchanged) and a fresh `x-request-id` (the gateway's own hop ID is not the same as what it sends
downstream — see "Generation" above). Watch the terminal logs (or `docker compose logs -f gateway
service-a service-b`) to see the same `correlationId` appear in all three services' log lines,
each with a different `requestId`.

To see the error path preserve the same IDs, stop `service-b` and repeat the request:

```bash
docker compose stop service-b
curl -i http://localhost:3000/api/v1/health/ready \
  -H "X-Correlation-ID: 11111111-1111-4111-8111-111111111111"
```

Expected: `503`, with the same `x-correlation-id` you sent still present on the error response.

See `docs/superpowers/specs/2026-08-12-correlation-request-id-design.md` for the full design
(not committed — `docs/` is `.gitignore`d, so this resolves only if you have that file locally).

## Known limitations

These are current, verifiable gaps in the implementation — not roadmap items, and not exhaustive.
For a full third-party assessment see `docs/superpowers/audit-2026-08-13-teamlead-technical-audit.md`
(not committed — `docs/` is `.gitignore`d, so this resolves only if you have that file locally).

- **Integration coverage is partial.** `pnpm test:int` exercises the real RabbitMQ broker via
  Testcontainers for import delivery, retry and dead-lettering (`back-end/service-a/test/int/`).
  `pnpm test:int` also exercises real MongoDB via Testcontainers for archive ingestion —
  decompression bounds, UTF-8 boundary correctness, payload shape and insert concurrency
  (`back-end/service-a/test/int/archive-ingestion.int.spec.ts`).
  Filesystem ownership across the shared archive volume is covered by
  `back-end/service-a/test/int/storage-ownership.int.spec.ts`.
  The Docker volume layout is still not covered at all. There is still no CI config in this repo.
- **The `service_b_queue.dlq` dead-letter queue has no consumer.** Messages that exhaust
  `RABBITMQ_MAX_RETRIES` land there and are never processed further. They are, however, now
  visible: each dead-lettered message is recorded as a `processing-logs` document with `status:
  'dead-lettered'` (`back-end/service-b/src/processing-log/import-events.controller.ts`'s
  `recordDeadLetter`), so the backlog can be queried and monitored even though nothing yet
  reprocesses it.
