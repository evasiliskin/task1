# Gateway aggregated health-check (`/health`, `/health/live`, `/health/ready`) — Design

Date: 2026-08-12

Supersedes: `2026-08-11-users-products-health-check-design.md`'s gateway health
section (the currently-implemented `GET /health/service-a` /
`GET /health/service-b` routes). Those routes and their controller are
removed; the RabbitMQ-ping mechanism they introduced is reused, not rebuilt.

## Goal

A single aggregated `GET /health` on the Gateway that reports the status of
six independently-checked things — the gateway process itself, RabbitMQ
broker connectivity, Service A availability, Service B availability, MongoDB
connectivity, Redis connectivity — plus Kubernetes-style
`GET /health/live` / `GET /health/ready` split for liveness vs readiness. One
failing dependency must never block or hide the status of the others, and a
hung Service A/B must never hang the endpoint.

## Current state (verified against the code, 2026-08-12)

- `back-end/gateway/src/health/`: `health.module.ts`, `health.controller.ts`
  (`GET /health/service-a`, `GET /health/service-b`, each
  `@HealthCheck() health.check([...])`), `rabbitmq-ping.health-indicator.ts`
  (`RabbitMqPingHealthIndicator.isHealthy(key, client)` — sends
  `client.send('health.check', {})`, `firstValueFrom(...pipe(timeout(pingTimeoutMs)))`,
  `indicator.up()`/`indicator.down()`), `rabbitmq-clients.tokens.ts`
  (`SERVICE_B_RMQ_CLIENT`, `SERVICE_A_RMQ_CLIENT`).
- `back-end/gateway/src/config/rabbitmq.config.ts`: Zod `registerAs('rabbitmq', ...)`
  — `url`, `serviceBQueue`, `serviceAQueue`, `pingTimeoutMs` (default 3000).
- Service A / Service B (`back-end/service-a`, `back-end/service-b`): RMQ-only
  microservices (`NestFactory.createMicroservice`, no HTTP), each with a
  `@MessagePattern('health.check')` handler already replying `{ status: 'ok' }`
  unconditionally via Terminus's `HealthCheckService.check([])` (zero
  indicators). **No changes needed here** — this already satisfies
  requirements 7/8 (lightweight, isolated from business logic).
- `@nestjs/terminus` is already a dependency of all three back-end packages.
  `@nestjs/swagger` is not installed anywhere. MongoDB/Redis clients,
  config, and docker-compose services do not exist anywhere in the repo.
- No structured-logging module or correlation-id/request-id propagation
  exists yet; a separate, currently-unimplemented design
  (`2026-08-12-correlation-request-id-design.md`) covers that as its own
  piece of work.
- Root `README.md` is stale (pre-dates the RabbitMQ pivot: describes TCP
  transport, Prisma, a single `service-b`). Out of scope to fix here.

## Decisions made during brainstorming

1. **MongoDB/Redis**: add real minimal clients (`mongodb` driver, `ioredis`)
   used *only* for health pinging, plus matching `mongodb`/`redis` services
   in `docker-compose.yml`. No persistence or caching logic is wired up
   anywhere else — this is a deliberate, scoped exception to CLAUDE.md's
   "Forbidden Without Explicit Approval" list (Redis, new infra), justified
   because the assignment's stated architecture and requirement 2 explicitly
   name them.
2. **Old routes**: `GET /health/service-a` and `GET /health/service-b` and
   their controller are deleted, not kept alongside the new routes.
3. **Logging (requirement 13)**: descoped from this task. A separate effort
   is implementing the pino/correlation-id design
   (`2026-08-12-correlation-request-id-design.md`); once that lands, it will
   be wired into the health-check code in a follow-up change. This spec
   leaves one clearly-commented extension point in `HealthCheckService`
   for that — no fake/placeholder logging is added now.
4. **Readiness criticality (requirement 15)**: RabbitMQ, Service A, and
   Service B are critical for `/health/ready` (the Gateway's sole purpose is
   routing to them through the broker). MongoDB and Redis are informational
   only — nothing in the Gateway consumes them for any request path (no
   persistence layer, no caching per CLAUDE.md) — so their failure is
   reported but never flips `/health/ready` to `503`.

## Architecture

```
Client
  │ GET /health | /health/live | /health/ready
  ▼
HealthController
  │
  ▼
HealthCheckService  ── shapes the {status, services} contract; decides which
  │                     failures are critical for /ready
  ├──▶ GatewayHealthIndicator            (trivial: process is running)
  ├──▶ RabbitMqConnectionHealthIndicator (new: broker reachability, own AMQP connection)
  ├──▶ RabbitMqPingHealthIndicator       (existing, reused: health.check RPC → Service A)
  ├──▶ RabbitMqPingHealthIndicator       (existing, reused: health.check RPC → Service B)
  ├──▶ MongoHealthIndicator              (new: MongoClient ping command)
  └──▶ RedisHealthIndicator              (new: ioredis .ping())
```

All indicators follow the existing `HealthIndicatorService`-based pattern
(Terminus v11 functional style — matches `RabbitMqPingHealthIndicator`
exactly). `HealthCheckService` calls Terminus's own
`HealthCheckService.check([...])`, which runs every indicator function
independently and never lets one rejection stop the others — this is what
satisfies requirement 10, with no custom `Promise.allSettled` needed.

### Why RabbitMQ and Service A/B are checked separately

`RabbitMqPingHealthIndicator` alone cannot distinguish "broker is down" from
"Service A/B crashed but broker is fine" — both look like a timeout on the
same `ClientProxy.send()`. `RabbitMqConnectionHealthIndicator` opens its own
dedicated `amqp-connection-manager` connection (independent of the two
`ClientProxy`s already registered for Service A/B) and checks
`.isConnected()`. If the broker is down, both this indicator and the two
service pings report failure — three independent, individually-correct
signals rather than one conflated one.

## Response contract

`GET /health` → always `200`.

```json
{
  "status": "ok",
  "services": {
    "gateway": "ok",
    "rabbitmq": "ok",
    "serviceA": "ok",
    "serviceB": "ok",
    "mongodb": "ok",
    "redis": "ok"
  }
}
```

`status` is `"ok"` only if all six are `"ok"`; otherwise `"degraded"`. Each
service value is `"ok"` or `"unavailable"` (mapped from Terminus's
`up`/`down`).

`GET /health/live` → always `200`:

```json
{ "status": "ok", "service": "gateway" }
```

No downstream calls — if this handler executes at all, the process is alive
by definition. This is the liveness/readiness distinction from requirement
14: liveness answers "is the process running," readiness answers "can this
process currently do its job."

`GET /health/ready` → same body shape as `/health`. `200` if `rabbitmq`,
`serviceA`, and `serviceB` are all `"ok"` (mongodb/redis may be
`"unavailable"` and readiness is still `200`); `503` if any of the three
critical dependencies is `"unavailable"`. `status` in the body follows the
same `"ok"`/`"degraded"` rule as `/health` (computed over all six, for
observability), while the **HTTP status code** is what encodes criticality.

**Implementation note to avoid ambiguity #1 — Terminus's throw-on-any-down
behavior**: Terminus's own `HealthCheckService.check()` throws
`ServiceUnavailableException` as soon as *any* passed indicator is down — it
has no concept of "informational vs critical." So `HealthCheckService` must
not rely on that throw directly. Instead, add one internal method (e.g.
`runAllChecks()`) that always calls Terminus's `check()` with **all six**
indicators, wrapped in try/catch — on catch, the caught
`ServiceUnavailableException`'s `getResponse()` still contains the full
`details` for every indicator (Terminus evaluates and records each one
internally, via `Promise.allSettled`, before deciding whether to throw), so
both the resolve and catch paths yield the same shape. Map that into
`{status, services}` and return it — this method never throws. Both
`/health` and `/health/ready` call this same method once (so
Service A/B/Mongo/Redis are each pinged exactly once per request, not
twice).

**Implementation note to avoid ambiguity #2 — the existing
`GlobalExceptionFilter` would corrupt a thrown 503 body.** The gateway's
`GlobalExceptionFilter` is registered as a global `APP_FILTER` (`@Catch()` —
catches everything) and unconditionally rewrites every exception's response
body into `IApiErrorResponse` (`{statusCode, error, correlationId,
timestamp, path}`), discarding whatever body the original exception carried.
If `HealthCheckService` threw `new ServiceUnavailableException(body)` for a
not-ready result, the client would receive the generic error envelope, not
the `{status, services}` contract — silently breaking requirement 3's
contract on the one code path that matters most. Do not throw for
`/health/ready`. Instead:
- `HealthCheckService.getReadiness()` returns `{ ready: boolean; result: AggregatedHealth }` (never throws).
- `HealthController`'s ready handler injects `@Res({ passthrough: true }) response: Response` (from `express`, same import already used by `GlobalExceptionFilter`), calls `response.status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)`, and returns `result` normally — Nest still serializes the return value as JSON, but since nothing was thrown, `GlobalExceptionFilter` never engages and the body reaches the client unmodified.
- This also improves layering: CLAUDE.md's rule that services must not depend on HTTP is satisfied more cleanly than the previous throw-based sketch — the only HTTP-specific code (`@Res`, `HttpStatus`) lives in the controller.

## New indicators

- `GatewayHealthIndicator.check('gateway')`: returns `indicator.up()`
  immediately. No I/O.
- `RabbitMqConnectionHealthIndicator.check('rabbitmq')`: maintains its own
  `amqp-connection-manager` connection (created from `rabbitmqConfig.url`,
  independent lifecycle from the two `ClientProxy`s), returns `up()` if
  `.isConnected()`, `down()` otherwise. Timeout-wrapped the same way as the
  existing ping indicator (`RABBITMQ_PING_TIMEOUT_MS`).
- `MongoHealthIndicator.check('mongodb')`: `MongoClient.db().command({ ping: 1 })`,
  timeout-wrapped via a new `MONGODB_PING_TIMEOUT_MS` (default 3000).
- `RedisHealthIndicator.check('redis')`: `ioredis` client `.ping()`,
  timeout-wrapped via a new `REDIS_PING_TIMEOUT_MS` (default 3000).
- `RabbitMqPingHealthIndicator`: unchanged, reused twice (`'serviceA'`,
  `'serviceB'` keys — note: the existing indicator used the keys
  `'service-a'`/`'service-b'` for the old routes; the new contract's JSON
  keys are `serviceA`/`serviceB` per requirement 2's example, so the
  `HealthCheckService` maps Terminus's `details['serviceA']` /
  `details['serviceB']` — the indicator's `key` argument is passed as
  `'serviceA'`/`'serviceB'` directly, no separate mapping table needed).

## New config

`back-end/gateway/src/config/mongodb.config.ts` (Zod, `registerAs('mongodb', ...)`):
- `uri` — env `MONGODB_URI`, default `mongodb://localhost:27017/gateway`.
- `pingTimeoutMs` — env `MONGODB_PING_TIMEOUT_MS`, default `3000`.

`back-end/gateway/src/config/redis.config.ts` (Zod, `registerAs('redis', ...)`):
- `url` — env `REDIS_URL`, default `redis://localhost:6379`.
- `pingTimeoutMs` — env `REDIS_PING_TIMEOUT_MS`, default `3000`.

Both follow the exact pattern of `rabbitmq.config.ts` (schema, `.parse()`,
factory throws on invalid input → fails app startup, matching CLAUDE.md's
"missing authorization/config must fail startup" principle applied to infra
config generally).

## Docker Compose

Add:
- `mongodb`: image `mongo:7`, no exposed host port needed (internal only),
  healthcheck via `mongosh --eval "db.adminCommand('ping')"`.
- `redis`: image `redis:7-alpine`, healthcheck via `redis-cli ping`.

`gateway` service gets `MONGODB_URI`, `REDIS_URL` env vars pointing at the
new service names, and `depends_on: mongodb (service_healthy)`,
`redis (service_healthy)` added alongside the existing `rabbitmq` dependency.

The gateway `Dockerfile`'s `HEALTHCHECK` instruction (currently curls
`/health/service-b` and `/health/service-a`, requiring both `200`) is
updated to curl `/health/ready` once, requiring `200`.

## Dependencies added (gateway only)

- `mongodb` (official driver — no ODM; there is no persistence layer to
  justify one yet, per CLAUDE.md).
- `ioredis`.
- `@nestjs/swagger` (+ its peer, already-satisfied by `class-validator`/
  `class-transformer` which are installed).

## Swagger

`main.ts` gains `SwaggerModule.setup('api-docs', app, document)`. Only the
three health routes are decorated (`@ApiOperation`, `@ApiOkResponse`,
`@ApiServiceUnavailableResponse` on `/health/ready`, with example bodies
matching the contract above). Not extended to the rest of the app —
out of scope.

## Removed

- `back-end/gateway/src/health/health.controller.ts` (routes folded into
  the new controller) and `back-end/gateway/src/health/health.controller.int.spec.ts`
  (rewritten for the new routes).
- `rabbitmq-clients.tokens.ts`'s exports are kept (still used by the new
  controller/module for the same two `ClientProxy`s) — not removed, just
  no longer imported by a file called `health.controller.ts` with the old
  routes.

## New/changed files (gateway)

- `src/health/health.controller.ts` — rewritten: `GET /health`,
  `GET /health/live`, `GET /health/ready`.
- `src/health/health-check.service.ts` — new: orchestration, contract
  shaping, criticality logic for `/ready`.
- `src/health/indicators/gateway.health-indicator.ts` — new.
- `src/health/indicators/rabbitmq-connection.health-indicator.ts` — new.
- `src/health/indicators/mongo.health-indicator.ts` — new.
- `src/health/indicators/redis.health-indicator.ts` — new.
- `src/health/rabbitmq-ping.health-indicator.ts` — unchanged, reused.
- `src/health/health.module.ts` — updated: registers new indicators,
  Mongo/Redis clients, new controller/service.
- `src/config/mongodb.config.ts`, `src/config/redis.config.ts` — new.
- `src/main.ts` — Swagger bootstrap added.
- `.env.example` — new vars added.
- `Dockerfile` — `HEALTHCHECK` updated.
- `README.md` (gateway package) — health-check section per requirement 19.
- `docker-compose.yml` (repo root) — `mongodb`, `redis` services added;
  `gateway` env/`depends_on` updated.
- `package.json` (gateway) — `mongodb`, `ioredis`, `@nestjs/swagger` added.

Test files, one per new/changed unit, matching existing Vitest conventions
(colocated `*.spec.ts`, BDD `describe`/`it('should ..., when ...')`,
`ClientProxy`/driver clients mocked with `vi.fn()`):
- `health-check.service.spec.ts` — the 8 scenarios from requirement 17.
- `indicators/gateway.health-indicator.spec.ts`
- `indicators/rabbitmq-connection.health-indicator.spec.ts`
- `indicators/mongo.health-indicator.spec.ts`
- `indicators/redis.health-indicator.spec.ts`
- `config/mongodb.config.spec.ts`, `config/redis.config.spec.ts`
- `health.controller.int.spec.ts` — rewritten for the three new routes.

## Testing (requirement 17 scenarios → where each is covered)

1. Everything healthy → `health-check.service.spec.ts`.
2. Service A unavailable → same file, asserts `serviceA: 'unavailable'`,
   overall `degraded`, other five unaffected.
3. Service B unavailable → same, mirrored.
4. RabbitMQ unavailable → `rabbitmq: 'unavailable'`; asserts Service A/B
   checks are *not* skipped (requirement 10) even though in practice they'd
   also fail if the broker is truly down — the test mocks them
   independently to prove the orchestration doesn't short-circuit.
5. MongoDB unavailable → informational only; `/health` shows `degraded`,
   `/health/ready` still `200`.
6. Redis unavailable → same as Mongo.
7. Timeout waiting for a microservice → mocked `ClientProxy.send()` never
   emits; asserts the indicator's `timeout(pingTimeoutMs)` rejects and the
   service is marked `unavailable` without hanging the test/endpoint.
8. Multiple dependencies unavailable simultaneously → e.g. Service B down
   + Redis down; asserts both are reported independently and the rest stay
   `ok`.

Plus: `/health/ready` returns `503` when a critical dependency is down and
`200` when only non-critical ones are down (new controller-level test).

## Out of scope

- Implementing structured logging / correlation-id propagation for health
  checks (separate, already-designed effort in
  `2026-08-12-correlation-request-id-design.md`).
- Fixing the stale root `README.md`.
- Any actual persistence or caching use of MongoDB/Redis beyond the ping.
- Kubernetes-specific probes, service mesh, Consul, Prometheus/Grafana,
  distributed tracing — per requirement 18.
