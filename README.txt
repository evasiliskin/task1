# task1

pnpm workspace monorepo: NestJS microservices back-end.

```
task1/
└── back-end/
    ├── api-gateway/         Public HTTP entrypoint - REST API, forwards to microservices over RabbitMQ
    ├── service-a/           Internal microservice (RabbitMQ transport only, no HTTP)
    ├── service-b/           Internal microservice (RabbitMQ transport only, no HTTP)
    └── libs/shared/         Shared library (@task1/shared) - errors, exception handling,
                              request-context/correlation-ID propagation, logging, GH Archive contracts
```

## Contents

- [Architecture](#architecture)
- [API reference](#api-reference)
- [Authentication](#authentication)
- [Getting started](#getting-started)
- [Common tasks](#common-tasks)
- [Tooling notes](#tooling-notes)
- [GitHub Archive Import & Analytics](#github-archive-import--analytics)
- [Correlation ID & Request ID](#correlation-id--request-id)

## Architecture

The gateway is the only HTTP surface. It receives REST requests, validates them, and forwards to
the internal microservices over NestJS's RabbitMQ transport using `ClientProxy` /
`@MessagePattern`. `service-a` and `service-b` expose no HTTP at all — they're reachable only as
RabbitMQ consumers.

```
Client
      │  HTTP (REST)
      ▼
   gateway  ──RabbitMQ RPC──▶  service-a  ──RabbitMQ RPC──▶  service-b
```

Every request through this chain carries a `correlationId` (stable for the whole flow) and a
`requestId` (fresh per hop) — see "Correlation ID & Request ID" below.

## API reference

All routes are served under a global `/api/v1` prefix (set in
[`main.ts`](back-end/api-gateway/src/main.ts)) with interactive Swagger docs at `/api-docs`. Full
request/response DTOs live under each module's `dto/` folder; this table is the map, not the spec.

| Method | Path | Purpose | Auth | RabbitMQ pattern → service |
| --- | --- | --- | --- | --- |
| `GET` | `/api/v1/health` | Aggregated health of gateway + all dependencies | Public | — |
| `GET` | `/api/v1/health/live` | Liveness probe (process is running) | Public | — |
| `GET` | `/api/v1/health/ready` | Readiness probe (`503` if RabbitMQ/service-a/service-b down) | Public | — |
| `POST` | `/api/v1/imports` | Trigger a download import for one GH Archive hour (`Idempotency-Key` header supported) | Required | `archive.import.download` → service-a |
| `POST` | `/api/v1/imports/upload` | Upload a `.json.gz` archive file to import (multipart) | Required | `archive.process.upload` → service-a |
| `GET` | `/api/v1/imports/:importId` | Get one import run's status/counters | Required | `imports.status.get` → service-a |
| `GET` | `/api/v1/events` | Search imported GitHub events, cursor pagination | Required | `events.search` → service-a |
| `GET` | `/api/v1/logs` | Search processing-log entries, cursor pagination | Required | `logs.search` → service-b |
| `GET` | `/api/v1/stats` | Processing statistics, optionally scoped to one import | Required | `stats.get` → service-b |
| `GET` | `/api/v1/reports/pdf` | Generate and stream a PDF processing report | Required | `reports.pdf.generate` → service-b |

See "GitHub Archive Import & Analytics" below for the data flow behind the imports/events/logs/
stats/reports endpoints, and "Authentication" for what "Required" currently means in practice.

## Authentication

Every endpoint above requires authentication except the three `/health*` routes, which are marked
`@Public()` ([`health.controller.ts`](back-end/api-gateway/src/health/health.controller.ts)).
Enforcement is one global guard, `AuthGuard`
([`auth.guard.ts`](back-end/api-gateway/src/auth/auth.guard.ts)), wired in via `APP_GUARD` in
`AuthModule`.

**Current state — intentional stub.** `AuthGuard` has no real credential-verification logic yet,
and it's written to fail closed rather than default-allow: every non-public request is currently
denied. This is deliberate — see the code comment in `auth.guard.ts` and
`auth.guard.spec.ts`, which documents it as "current unimplemented stub" — the seam is in place so
a real provider (Auth0, Passport.js, JWT/OIDC, etc.) can be dropped in behind it later, populating
`request.user` (`authenticated-user.interface.ts`). Until then:

- Every endpoint besides `GET /health`, `/health/live`, `/health/ready` returns `403 Forbidden`.
- Integration tests override the guard (`.overrideProvider(AuthGuard).useValue({ canActivate: ()
  => true })`) to exercise the endpoints they target — follow the same pattern in new
  `*.controller.int.spec.ts` files.
- The curl examples in this README (below) describe the intended request/response shape once real
  auth is wired in; running them as-is against an unmodified checkout currently returns `403`.

## Getting started

Node version is pinned in [`.nvmrc`](.nvmrc) (kept in sync with `engines.node` in
[`package.json`](package.json) and the Docker images). Switch to it before installing:

```bash
nvm use

pnpm install

# start RabbitMQ + service-a + service-b + gateway
pnpm docker:up

# or run services individually against a local RabbitMQ:
cp back-end/api-gateway/.env.example back-end/api-gateway/.env
cp back-end/service-a/.env.example back-end/service-a/.env
cp back-end/service-b/.env.example back-end/service-b/.env

pnpm dev:service-b
pnpm dev:service-a
pnpm dev:api-gateway
```

- Gateway REST API: http://localhost:3000/api/v1 — see "API reference" above for the full
  endpoint list (health checks at `/api/v1/health`, `/health/live`, `/health/ready`)
- Gateway Swagger docs: http://localhost:3000/api-docs
- RabbitMQ management UI: http://localhost:15672 (guest/guest)
- `service-a`/`service-b`: internal only, reachable over RabbitMQ (not exposed to the browser)
- MongoDB: each service owns its own database (`gateway`, `service_a`, `service_b`) — service-a
  persists imported GitHub events and import-run tracking, service-b persists processing-log
  entries (see "MongoDB indexes" below); the gateway itself only pings MongoDB for its own health
  check, it has no collections of its own
- Redis: service-a records pipeline metrics via RedisTimeSeries (see "RedisTimeSeries metrics"
  below); the gateway only pings it for health checks, no caching is implemented against it
- set `MONGODB_URI`/`REDIS_URL` in `back-end/api-gateway/.env` if running the gateway outside
  Docker

## Common tasks

| Command | What it does |
| --- | --- |
| `pnpm build` | Build every workspace package |
| `pnpm test` | Run every package's tests (Vitest for all three back-end services) |
| `pnpm lint` | Lint the back-end services (ESLint) |
| `pnpm format` / `pnpm format:check` | Prettier across the whole workspace |
| `pnpm check` | `lint` + `test` - also runs automatically on `git push` (Husky) |
| `pnpm docker:up` / `pnpm docker:down` | Start/stop RabbitMQ and all three back-end services |

## Tooling notes

- **Package manager**: pnpm workspaces (`pnpm-workspace.yaml`: `back-end/*`, `back-end/libs/*`).
- **Testing**: Vitest for all three NestJS services (`*.spec.ts` unit tests, `*.int.spec.ts`
  HTTP-integration tests for the gateway via `supertest`).
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
gateway's REST API. Full design: `docs/superpowers/specs/2026-08-12-github-archive-platform-design.md`.

### Data flow

```
Client --HTTP--> gateway --RabbitMQ RPC--> service-a --gunzip/parse/validate--> MongoDB (events)
                                                |
                                                +--RabbitMQ emit (lifecycle events)--> service-b
                                                                                          |
                                                                                MongoDB (processing-logs)
                                                                                          |
                                                                          RedisTimeSeries (metrics)
```

`service-a` and `service-b` are RMQ-only — no HTTP adapter, reachable only through the gateway.
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
large the source archive is. `pnpm --filter service-a run bench:memory <dateHour>` runs this real
pipeline against a live `docker compose` stack and prints `process.memoryUsage().rss` on a 1s
interval so this is directly observable rather than asserted:

```bash
pnpm docker:up
cp back-end/service-a/.env.example back-end/service-a/.env  # point MONGODB_URI/STORAGE_DIR at the running stack if not using docker:up's own network
pnpm --filter service-a run bench:memory 2026-08-11-0
```

Expected output: a `[download]` line every second while the archive downloads (its `bytesReadSoFar`
climbing toward the final archive size), then a `[process]` line every second while it's parsed and
inserted — in both phases, `rss` should stay roughly flat rather than growing with bytes consumed.
This is a manual diagnostic (needs a real network archive + a running Mongo), not part of the
automated (mocked) test suite, and CI does not assert a threshold on it — RSS thresholds are flaky
across machines and Node versions; read the printed numbers instead.

### Pagination

Every list endpoint (`GET /events`, `GET /logs`) uses keyset (cursor) pagination —
`{createdAt/timestamp, eventId/_id}` — never `skip()`. Each response includes `nextCursor`
(absent once exhausted); pass it back as the next request's `cursor` query param.

### MongoDB indexes

`events` (owned by `service-a`): `{eventId:1}` unique (idempotency + dedup),
`{createdAt:-1, eventId:-1}` (default pagination), plus one compound index per common
single-filter access pattern — `{eventType:1, createdAt:-1}`, `{'repo.name':1, createdAt:-1}`,
`{'actor.login':1, createdAt:-1}`. `imports` (owned by `service-a`): one document per import run,
tracking status/counters/error samples. `processing-logs` (owned by `service-b`):
`{importId:1, status:1}` unique (makes RabbitMQ redelivery a no-op), `{timestamp:-1, _id:-1}`
(default pagination), `{importId:1, timestamp:-1}`, `{status:1, timestamp:-1}`. Each service only
ever queries its own collections — cross-service Mongo access never happens.

### RabbitMQ event flow

`service-a` wraps every import (download- or upload-triggered) with three fire-and-forget
lifecycle events — `github.import.started`, `.completed`, `.failed` — carrying metadata only
(counts, ids, timestamps; never event payloads). `service-b` consumes all three idempotently
(unique `{importId, status}` index makes redelivery a no-op) into its own `processing-logs`
collection, manually acking after a successful write and nacking (bounded retry, then
dead-letter) on failure. Consumer concurrency is bounded via `prefetchCount` — never unbounded
parallel handling.

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
(`http://localhost:3000/api-docs`). All routes below other than `/health*` require authentication —
see "Authentication" above; the current stub denies them until real auth is wired in, so treat this
as the intended flow rather than something runnable end-to-end on an unmodified checkout:

```bash
pnpm docker:up

# trigger a download import for a real GH Archive hour
curl -s -X POST http://localhost:3000/api/v1/imports -H 'Content-Type: application/json' \
  -d '{"dateHour": "2026-08-11-0"}'
# => {"importId": "..."}

# poll status until it reaches "completed"
curl -s http://localhost:3000/api/v1/imports/<importId>

# search the imported events
curl -s 'http://localhost:3000/api/v1/events?type=PushEvent&limit=10'

# view processing logs and stats
curl -s http://localhost:3000/api/v1/logs
curl -s http://localhost:3000/api/v1/stats

# download the PDF report
curl -s http://localhost:3000/api/v1/reports/pdf?importId=<importId> -o report.pdf
```

### Trade-offs

No gRPC, no cross-batch transaction spanning a whole import, no unlimited filter-combination
indexing, no auth, no Repository/CQRS/event-sourcing/extra-caching layer — all deliberate, all
explained in the design doc's own
[Out of scope / trade-offs](docs/superpowers/specs/2026-08-12-github-archive-platform-design.md#out-of-scope--trade-offs)
section rather than duplicated here.

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
request context (`core/request-context/` in each service — see the design doc referenced below),
and makes them available to every controller, service, and log line for the duration of that
request with no manual parameter threading.

**In logs.** Every service logs through a small `LoggerService`/`AppLogger` wrapper over
`pino` (`core/logger/` in each service). Both `correlationId` and `requestId` are merged into
every log line automatically via pino's `mixin` option, which reads the active request context —
nothing needs to explicitly pass either ID to a log call. A single request produces log lines like:

```
INFO [Gateway] Request started correlationId=c1 requestId=r1
INFO [ServiceA] Processing request correlationId=c1 requestId=r2
INFO [ServiceB] Processing request correlationId=c1 requestId=r3
```

— the shared `correlationId` lets you reconstruct the whole flow across all three services' logs,
while each service's own `requestId` identifies exactly which hop each log line belongs to.

**Errors.** If any service in the chain fails, the error still carries the same IDs: the gateway's
HTTP error response includes both `X-Correlation-ID`/`X-Request-ID` response headers and a JSON
body with `correlationId`/`requestId` fields, sourced from the same request context - not
re-derived - so they always match what was logged for that request.

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

See `docs/superpowers/specs/2026-08-12-correlation-request-id-design.md` for the full design.
