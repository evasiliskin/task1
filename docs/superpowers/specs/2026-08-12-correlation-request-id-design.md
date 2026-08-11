# Correlation ID & Request ID propagation — Design

Date: 2026-08-12

## Goal

Give every request flowing through `gateway → service-a → service-b` a stable
`correlationId` (one per logical business flow) and a per-hop `requestId` (one per
service-to-service call), available automatically to controllers, services, and every
log line, with no manual threading of IDs through method signatures.

This also completes the logging work drafted (but never implemented) in
`2026-08-11-pino-logger-design.md`: that spec already reserved a `REQUEST_ID_ATTRIBUTE`
constant it never wired up. This design implements both IDs together instead of
retrofitting one later.

## Current state (verified against the code, 2026-08-12)

- `gateway` is a plain HTTP (Express) app (`NestFactory.create`). `service-a` and
  `service-b` are RMQ-only microservices (`NestFactory.createMicroservice`, RMQ
  transport) with **no HTTP adapter at all** — Nest never calls `configure()` on their
  modules, so Express-style middleware cannot attach to them.
- The only cross-service calls today are the gateway's independent health pings:
  `gateway → service-a` (`GET /health/service-a`) and `gateway → service-b`
  (`GET /health/service-b`), each via a plain `@nestjs/microservices` `ClientProxy.send('health.check', {})`
  with no message headers. **`service-a` never calls `service-b`.**
- No middleware, interceptor, guard, or logger module exists anywhere in the three
  services. The only correlation-ID code today is
  `gateway/src/core/exception-handling/global-exception.filter.ts`'s
  `resolveCorrelationId`, which reads `x-correlation-id` or mints a `randomUUID()`
  **only on the HTTP error path** — it has no request-id equivalent, and RMQ errors
  (`service-a`/`service-b`'s `rpc-exception.filter.ts`) carry no correlation data at all.
- No `uuid` package is installed anywhere; the codebase already uses Node's built-in
  `randomUUID()` from `node:crypto`. No `libs/*` workspace package exists
  (`pnpm-workspace.yaml` only globs `front-end` and `back-end/*`) — every existing
  cross-cutting concern (`config/`, `core/errors/`, `core/exception-handling/`) is
  duplicated per service under that service's own `src/`, not shared.

## Architecture

```
                         correlationId = C1
                                |
                                v
Client ────────> Gateway ─────> Service A ─────> Service B
  X-Correlation-ID: C1
  X-Request-ID: R1        R1              R2                R3
                           |               |                 |
                           +---------------+-----------------+
                                  same correlationId, C1
                          each hop mints its own fresh requestId
```

Rule that produces this: **a service's own ingress `requestId` (assigned by whoever
called it) is never forwarded as-is.** Every outbound call mints a brand-new
`requestId` via `randomUUID()`, while the `correlationId` is always forwarded unchanged.
`gateway`'s ingress requestId is `R1` (from the client, or generated); when it calls
`service-a` it mints `R2` for that call; `service-a`'s ingress requestId is therefore
`R2`; when it calls `service-b` it mints `R3`; `service-b`'s ingress requestId is `R3`.

## Module layout (duplicated per service, matching existing convention)

Decision: **no shared `libs/` package.** The ticket's `libs/request-context/` was "for
example" only ("the exact implementation is up to you"); this repo has no workspace
infrastructure for a shared package today (no `libs/*` glob, no cross-service tsconfig
paths), and every other cross-cutting concern in this codebase (`core/errors`,
`core/exception-handling`) is already duplicated per service rather than shared.
Introducing a new shared package now would be new build infrastructure the ticket
doesn't require and CLAUDE.md asks us not to add speculatively. Each of `gateway`,
`service-a`, `service-b` gets an identical `src/core/request-context/`:

```
core/request-context/
  request-context.types.ts        — RequestContext interface, header name constants,
                                     attribute name constants, MAX_ID_LENGTH
  request-context.service.ts      — AsyncLocalStorage<RequestContext> wrapper:
                                     run(ctx, fn), getCorrelationId(), getRequestId(),
                                     getAttributes() -> { correlationId, requestId }
  id-validation.util.ts           — resolveId(rawHeaderValue): string — trim, validate,
                                     or mint a fresh randomUUID()
  propagation.util.ts             — buildOutboundHeaders(ctx: RequestContext):
                                     Record<string, string> — { correlationId forwarded,
                                     requestId freshly minted }
  request-context.module.ts       — @Global(), exports RequestContextService
```

`gateway` additionally gets:
```
core/request-context/
  request-context.middleware.ts   — NestMiddleware, applied to all routes
```

`service-a` / `service-b` additionally get:
```
core/request-context/
  rmq-context.interceptor.ts      — global NestInterceptor (bound via APP_INTERCEPTOR)
```

No global mutable state anywhere — `AsyncLocalStorage` is instance state on
`RequestContextService`, itself a normal singleton Nest provider.

### `RequestContext` shape

```ts
export interface RequestContext {
  correlationId: string;
  requestId: string;
}
```

### Header / attribute constants (`request-context.types.ts`, per service)

```ts
export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const REQUEST_ID_HEADER = 'x-request-id';
export const MAX_ID_LENGTH = 200;
```

## ID validation (`id-validation.util.ts`)

Applied identically at **every** ingress point — the gateway's HTTP middleware and
both services' RMQ interceptor — so external client input and internal service-to-service
messages are validated the same way (deny-by-default, fail-closed, per CLAUDE.md):

```ts
export function resolveId(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();

  if (trimmed && trimmed.length <= MAX_ID_LENGTH && SAFE_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }
  return randomUUID();
}
```

- Trims whitespace.
- Rejects empty (post-trim) values.
- Rejects values over `MAX_ID_LENGTH` (200 chars) — bounds header-size abuse.
- Rejects anything outside `SAFE_ID_PATTERN = /^[\x21-\x7E]+$/` (printable ASCII, no
  spaces/control characters) — blocks header/log injection (e.g. embedded CRLF) via a
  spoofed ID. This is intentionally looser than "must be a UUID" — the ticket's example
  client IDs happen to be UUIDs, but nothing requires a caller's `X-Correlation-ID` to be
  one; only *generated* IDs must be UUID v4.
- Any rejection silently falls back to a fresh `randomUUID()` — never thrown, per
  requirement 8 ("generate a new UUID instead of trusting it").

## Gateway: HTTP ingress (`request-context.middleware.ts`)

- `NestMiddleware`, applied via `RequestContextModule.configure()` to `{ path: '*', method: RequestMethod.ALL }`.
- Reads `X-Correlation-ID` / `X-Request-ID` request headers, resolves each through
  `resolveId(...)`.
- Immediately sets both response headers (`res.setHeader(CORRELATION_ID_HEADER, ...)`,
  same for request ID) — covers the success path for requirement 1/2 unconditionally,
  before the handler even runs.
- Runs the rest of the request (`next()`) inside
  `requestContextService.run({ correlationId, requestId }, next)`.

## service-a / service-b: RMQ ingress (`rmq-context.interceptor.ts`)

- Global `NestInterceptor` bound via `APP_INTERCEPTOR` in each service's
  `RequestContextModule`.
- Reads `context.switchToRpc().getContext<RmqContext>().getMessage().properties.headers`,
  resolves `x-correlation-id` / `x-request-id` through the same `resolveId(...)`.
- Wraps the handler's `Observable` so it executes inside
  `requestContextService.run({ correlationId, requestId }, () => next.handle())`
  (`AsyncLocalStorage.run` needs a synchronous callback; the interceptor calls
  `next.handle()` — which returns synchronously — inside that callback, so the
  subscription and downstream async work all inherit the store correctly).

## Outbound propagation (every `ClientProxy.send` call site)

Every existing and new RMQ call is updated to attach headers via `RmqRecordBuilder`,
built from `propagation.util.ts`'s `buildOutboundHeaders(ctx)`:

```ts
const headers = buildOutboundHeaders(requestContextService.getAttributes());
const record = new RmqRecordBuilder(payload).setOptions({ headers }).build();
client.send(pattern, record);
```

Call sites touched:
- `gateway/src/health/rabbitmq-ping.health-indicator.ts` (`client.send('health.check', {})`
  → `client.send('health.check', record)`), used for both `/health/service-a` and
  `/health/service-b`.
- **New**: `service-a`'s health handler calling `service-b` (see "3-hop demo" below).

No business DTO changes anywhere — the payload argument is untouched; only the
transport-level message headers carry the IDs, per the ticket's explicit constraint.

## Logging — full pino/nestjs-pino now

Extends `2026-08-11-pino-logger-design.md`'s module layout (`core/logger/` per service:
`logger.module.ts`, `logger.service.ts`, `app-logger.ts`, `pino-config.factory.ts`,
`nest-logger.bridge.ts`, `types.ts`), with two changes from that draft:

1. **Both `correlationId` and `requestId`** are pulled from `RequestContextService` into
   every log line via pino's `mixin` option (`mixin: () => requestContextService.getAttributes()`),
   not just `correlationId`.
2. **Resolves the draft's open question about RMQ-only services concretely, based on
   what we now know about this codebase:** `service-a`/`service-b` are created via
   `NestFactory.createMicroservice` with no HTTP adapter, so Nest never invokes
   `configure()` on them — `nestjs-pino`'s `LoggerModule` (which attaches `pino-http` as
   Express middleware) has nothing to attach to there. Rather than depend on undefined
   behavior:
   - **`gateway`** uses `nestjs-pino`'s `LoggerModule.forRootAsync` (real HTTP app, gets
     `pino-http`'s automatic request/response auto-logging for free, health-check routes
     excluded from auto-logging via `autoLogging.ignore`).
   - **`service-a` / `service-b`** construct a bare `pino(options)` instance directly
     (no `pino-http`, no `nestjs-pino` `LoggerModule`) — pino's `mixin` option works
     identically on a standalone instance. Both are wrapped in the exact same
     `LoggerService`/`AppLogger` API as gateway, so call sites and tests are identical
     across all three services; only the construction differs.
- `NestLoggerBridge` (implements Nest's internal `LoggerService` interface) routes
  Nest's own framework logs through the same pipeline in all three services, replacing
  the current bare `console.error` in each `main.ts`'s `bootstrap().catch(...)`.
- Log line shape matches the ticket's plain-text example
  (`INFO [Gateway] Request started correlationId=c1 requestId=r1`) — achieved via pino's
  `messageKey`/formatting or `pino-pretty` in development; production uses structured
  JSON (`{ correlationId, requestId, ... }`) per the original logger design, which still
  satisfies requirement 5 ("logs automatically include `{correlationId, requestId}`").
- `config/logger.config.ts` (per service, `registerAs('logger', ...)` + Zod, matching the
  existing `app.config.ts`/`rabbitmq.config.ts` pattern): `level` (`LOG_LEVEL`),
  `transport: 'json' | 'pretty'` (`APP_LOG_TRANSPORT`).

## Error handling

- `gateway/src/core/exception-handling/global-exception.filter.ts`: `resolveCorrelationId`
  is removed; both IDs are read from `RequestContextService` (already seeded by the
  middleware for every request) instead of re-deriving from the raw header. Response
  headers `X-Correlation-ID` and `X-Request-ID` are (re-)set from context. `IApiErrorResponse`
  (`error-response.types.ts`) gains a `requestId: string` field alongside the existing
  `correlationId`.
- `service-a` / `service-b`'s `rpc-exception.filter.ts` (`RpcAppExceptionFilter`): no wire
  payload change (the ticket says not to add tracing metadata to business payloads, and
  the gateway already has its own correct IDs in its own context — adding them to the RPC
  error payload would be redundant). The existing `this.logger.error(...)` call
  automatically gains `correlationId`/`requestId` once `NestLoggerBridge` is wired in —
  no filter code changes needed there beyond what the bridge already provides.
- Stack traces / internal exception details are still never sent to the client — this
  behavior already exists via `ErrorFormatService`'s strategies and is unchanged.

## 3-hop demonstration: extending the health check (no new business endpoint)

The ticket's full propagation example (`gateway → service-a → service-b`, one
correlationId, three requestIds) has no real equivalent today. Rather than invent a new
`/api/example`-style endpoint purely to demonstrate tracing, we extend the existing
health check — reusing real infrastructure instead of adding a speculative feature:

- `service-a` gains its own `ClientsModule` registration for a `SERVICE_B_RMQ_CLIENT`,
  a duplicated `RabbitMqPingHealthIndicator` (same shape as gateway's), and its
  `health.controller.ts` handler changes from `this.health.check([])` to
  `this.health.check([() => this.serviceBPing.isHealthy('service-b', this.serviceBClient)])`.
- `service-a/src/config/rabbitmq.config.ts` gains `serviceBQueue` (env
  `RABBITMQ_SERVICE_B_QUEUE`) and `pingTimeoutMs` (env `RABBITMQ_PING_TIMEOUT_MS`,
  default `3000`), matching gateway's existing config shape.
- `docker-compose.yml`'s `service-a` environment gains `RABBITMQ_SERVICE_B_QUEUE:
  service_b_queue`. `service-a/.env.example` documents the new var.
- Result: `GET /health/service-a` on the gateway now genuinely exercises the full
  3-hop chain (gateway mints R2 for its call to service-a; service-a's ingress
  requestId is R2; service-a mints R3 for its call to service-b; service-b's ingress
  requestId is R3), all sharing gateway's ingress correlationId C1.
  `GET /health/service-b` remains an unchanged direct 2-hop ping.
- **Error scenario for requirement 9 comes for free, not simulated**: if `service-b` is
  unreachable/down, `service-a`'s indicator reports `down()`, Terminus's
  `HealthCheckService.check` throws `ServiceUnavailableException` inside the RMQ
  handler, `service-a`'s existing `RpcAppExceptionFilter` formats and re-throws it, the
  gateway's existing `serialized-rpc-error.format-strategy.ts` parses it, and the
  gateway's `GlobalExceptionFilter` produces the HTTP error response carrying the
  gateway's own (correct, unbroken) `correlationId`/`requestId` — a real integration
  path, not a mock.

## Dependencies

New, added where needed:
- `gateway`: `nestjs-pino`, `pino`, `pino-http`, `pino-pretty` (dependency, not dev —
  pino resolves transport targets by module name at runtime).
- `service-a`, `service-b`: `pino`, `pino-pretty` only (no `nestjs-pino`/`pino-http` —
  see Logging section).
- No `uuid` package anywhere — `node:crypto`'s `randomUUID()` (already in use) covers
  every ID-generation need.

## Testing

Matches existing conventions (BDD `it('should X, when Y')` phrasing, `vi.fn()`-mocked
`ClientProxy` returning RxJS `of(...)`/`throwError(...)`, `.int.spec.ts` + `supertest`
for HTTP-level tests, colocated `*.spec.ts`):

**Per service** (`request-context.service.spec.ts`, `id-validation.util.spec.ts`,
`propagation.util.spec.ts`): AsyncLocalStorage isolation across concurrent contexts;
`resolveId` accepts valid values, trims, rejects empty/oversized/unsafe values and
falls back to a generated UUID; generated IDs are valid UUID v4 (regex check);
`buildOutboundHeaders` forwards `correlationId` unchanged and always mints a fresh
`requestId` (asserted `!==` the input context's `requestId`).

**Gateway** (`request-context.middleware.spec.ts`): the six scenarios from requirement
9 — request without `X-Request-ID` generates one; request with `X-Request-ID` reuses
it; same for `X-Correlation-ID`; response contains both headers; generated IDs are
valid UUIDs. Updated `global-exception.filter.spec.ts` / existing
`health.controller.int.spec.ts` assert both response headers and the error body's new
`requestId` field.

**service-a / service-b** (`rmq-context.interceptor.spec.ts`): extracts headers from a
mocked `RmqContext`; falls back to generated IDs when headers are absent/invalid; runs
the handler inside the seeded context (assert `RequestContextService.getCorrelationId()`
is readable from inside a handler invoked through the interceptor).

**Propagation, end-to-end-ish**: since the three services are separate packages with no
shared import path, propagation correctness is verified per-hop rather than via one
cross-package test — each hop's own tests already prove `correlationId` forwarded
unchanged / `requestId` freshly minted, and composition follows by construction. An
updated `service-a` health-indicator/controller spec (mirroring gateway's existing
`rabbitmq-ping.health-indicator.spec.ts`) additionally asserts the outbound headers
built for the call to `service-b` carry the same correlation ID that arrived on
`service-a`'s inbound message, and a `requestId` distinct from the inbound one —
directly exercising the `C1 === C1 === C1`, `R1 !== R2 !== R3` invariants from
requirement 9 at the unit level.

**Error scenario**: extend `service-a`'s health-indicator spec with a case where the
`service-b` client's `send(...)` errors/times out, asserting `isHealthy` reports `down`
(exercising the real path described above) plus a gateway-side
`health.controller.int.spec.ts` case asserting the resulting HTTP error response still
carries the gateway's original correlation/request IDs.

## Documentation

`README.md` gains a new section covering: what `correlationId` is vs. `requestId`
(with the definitions from requirement 2), how each is generated (client header or
`randomUUID()` v4), how they propagate (RMQ message headers via `RmqRecordBuilder`,
never business payloads), how they appear in logs (pino JSON / pretty-printed fields),
and how to exercise this locally (`docker compose up`, then
`curl -i http://localhost:3000/health/service-a` with and without
`X-Correlation-ID`/`X-Request-ID` headers, showing the response headers and the three
services' logs sharing one `correlationId` with three different `requestId`s). Includes
the architecture diagram from this spec's "Architecture" section.

## Out of scope

- No changes to the front-end.
- No new AWS services, no Redis/caching, no message broker changes beyond message
  headers (per CLAUDE.md's forbidden-without-approval list).
- No user/auth-derived log fields — no auth exists yet in this project (consistent with
  the original logger design).
- No retry/dead-letter/queue-durability changes.
- No change to the RPC error wire payload shape (see "Error handling" above).
