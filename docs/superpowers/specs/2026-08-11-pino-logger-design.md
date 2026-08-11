# Pino logger module per service — Design

## Goal

Replace ad-hoc `console.error`/bare `new Logger(...)` usage in `gateway`, `users-service`,
and `products-service` with structured JSON logging via `nestjs-pino`, including a
correlation ID that survives the hop from the gateway's HTTP layer across RabbitMQ to the
two downstream microservices, so one logical request produces joinable log lines across
all three services.

This spec targets full feature parity with the reference implementation at
`D:\Dev\UHCloud\uhcloud_backend\src\core\logger` (and its `core/request-context`
companion), adapted to this project's different transport shape: `gateway` is HTTP
(Express), while `users-service` and `products-service` are pure RabbitMQ microservices
with **no HTTP adapter at all** — every endpoint is a `@MessagePattern`/`@EventPattern`.

## Library choice

Verified against the real npm registry and `nestjs-pino`'s published `peerDependencies`
(not guessed):

- `nestjs-pino@4.6.1` — peer-compatible with `@nestjs/common ^11.0.0` (all three services
  run NestJS 11), `pino ^7-10`, `pino-http ^6-11`, `rxjs ^7.1.0`.
- `pino@10.3.1`, `pino-http@11.0.0`, `pino-pretty@13.1.3`.
- `pino-pretty` is installed as a regular `dependency` (not dev-only) on all three
  services — pino resolves transport targets by module name at runtime via a worker
  thread, so it must be resolvable wherever the process actually runs, matching how the
  reference project installs it.

**Open verification item (flag for the implementing agent, do not assume):**
`nestjs-pino`'s `LoggerModule` implements `NestModule.configure()` to attach `pino-http`
Express middleware. Whether this errors, no-ops, or works cleanly when the host Nest
application has no HTTP adapter at all (`NestFactory.createMicroservice` with RMQ-only
transport, as used by `users-service`/`products-service`) is **not confirmed** by the
library's docs. Verify empirically against the real `@nestjs/microservices@11` +
`nestjs-pino@4.6.1` combination before finalizing the implementation for those two
services. If `LoggerModule.forRoot(...)` errors in that context, fall back to
constructing the pino instance directly — `pino(pinoConfigFactory().pinoHttp)` — and
exposing it through the same `LoggerService`/`AppLogger` API described below, so nothing
downstream needs to change. Also verify `@InjectPinoLogger`/`PinoLogger` DI resolves
correctly in a microservice-only application context.

## Module layout

No shared `libs/` package exists in this pnpm workspace (each service already duplicates
its own `config/`, `core/`, `health/` folders independently — see the config-module
spec). The logger module follows the same per-service duplication.

### gateway (`back-end/gateway/src/`)

```
core/logger/
  logger.module.ts        — @Global(), imports RequestContextModule, registers
                             LoggerModule.forRootAsync from nestjs-pino, provides LoggerService
  logger.service.ts        — getLogger(source, channel = 'http'): AppLogger
  app-logger.ts             — binds { source, channel, ...fields } on every call
  pino-config.factory.ts   — level, redaction, serializers, transport, mixin (Section 3)
  nest-logger.bridge.ts    — routes Nest's own framework logs through pino
  types.ts                 — LogChannel, LogFields, header/attribute name constants
core/request-context/
  request-context.module.ts     — @Global(), applies RequestContextMiddleware to all routes
  request-context.service.ts    — AsyncLocalStorage wrapper (run/setAttribute/getAttribute/getAttributes)
  request-context.middleware.ts — reads/generates x-correlation-id, seeds context, echoes response header
config/
  logger.config.ts          — registerAs('logger', ...) + Zod (Section 4)
  environment.helper.ts     — reads NODE_ENV once, exposes isProduction/nodeEnv
```

### users-service / products-service (`back-end/<service>/src/`)

Identical `core/logger/` and `config/logger.config.ts` (default channel `'rmq'` instead
of `'http'`), but **no** `RequestContextMiddleware` — there is no HTTP layer for Express
middleware to attach to. Instead:

```
core/request-context/
  request-context.module.ts        — @Global(), no middleware wiring
  request-context.service.ts       — same AsyncLocalStorage wrapper
  rmq-context.interceptor.ts       — global NestInterceptor (Section 2); replaces the
                                      middleware's job for RMQ and also performs the
                                      per-message auto-logging described in Section 3
```

## Correlation ID / request-context flow

### gateway (HTTP, origin point)

- `RequestContextMiddleware` applies to all routes (`forRoutes({ path: '*', method: ALL })`),
  runs the rest of the request inside `requestContextService.run(...)`.
- Reads `x-correlation-id` from the incoming request header; if absent or empty, generates
  one with `randomUUID()`.
- Stores it as the `correlationId` attribute in the AsyncLocalStorage context and echoes it
  back via `res.setHeader('x-correlation-id', ...)`.
- The pino `mixin` (Section 3) pulls `{ correlationId }` from `RequestContextService` into
  every log line automatically — including lines written by plain `new Logger(...)` calls
  (via `NestLoggerBridge`) and raw `PinoLogger` usage, not just calls that pass fields
  explicitly.
- **Existing touch-point:** `core/exception-handling/global-exception.filter.ts` currently
  mints its own `randomUUID()` correlation ID *only on the error path*
  (`resolveCorrelationId` in `global-exception.filter.ts`). This changes to read the
  correlation ID from `RequestContextService` (already seeded for every request by the
  middleware) instead of generating a second, independent one — so the ID in the error
  response body, the `x-correlation-id` response header, and every log line for that
  request are all the same value. This is a direct, necessary consequence of adding the
  middleware, not an unrelated refactor.

### users-service / products-service (RMQ, receiving end)

- `RmqContextInterceptor` (bound globally via `APP_INTERCEPTOR`) reads
  `context.switchToRpc().getContext<RmqContext>().getMessage().properties.headers['x-correlation-id']`.
  If present, seeds `RequestContextService` with it; if absent (e.g. a message published
  without going through the gateway), generates a fresh one — same fallback rule as the
  HTTP side.
- Runs the handler inside `requestContextService.run(...)`, then logs entry/exit (message
  pattern name, correlation ID, duration, success/error) — the RMQ analogue of `pino-http`'s
  automatic HTTP request logging (see Section 3 for the `'health.check'` exclusion).
- The pino `mixin` on these two services pulls from the same `RequestContextService` shape,
  so log lines look identical across all three services.
- **Existing touch-point:** `core/exception-handling/rpc-exception.filter.ts` currently logs
  via a bare `new Logger(...)` with no correlation ID at all. Once `NestLoggerBridge` is in
  place, its existing `this.logger.error(...)` call automatically picks up the correlation
  ID through the mixin — no code change needed there beyond what the bridge already
  provides.

### gateway (RMQ, sending end)

- `health/rabbitmq-ping.health-indicator.ts` currently sends
  `client.send('health.check', {})`. This changes to attach the correlation ID as a message
  header:

  ```ts
  const record = new RmqRecordBuilder({})
    .setOptions({ headers: { 'x-correlation-id': requestContextService.getAttribute('correlationId') } })
    .build();

  client.send('health.check', record);
  ```

- Any future `ClientProxy.send(...)` call site added to the gateway should follow the same
  pattern.

## Pino config factory (per service)

**Base fields** (`base` in pino options) — same shape across all three, `service` differs:
`service` (`'gateway'` / `'users-service'` / `'products-service'`), `environment`,
`nodeVersion`, `pid`, `hostname` (all read via each service's own
`config/environment.helper.ts`/`process`, never via a shared cross-service import).

**Redaction** — carried over from the reference as the default set (generic, not tied to
UHCloud's domain):
- Fixed paths: `req.headers.authorization`, `req.headers.cookie`,
  `res.headers["set-cookie"]`, `*.password`, `*.token`, `*.accessToken`, `*.refreshToken`
- Depth-limited deep-redact walk (`DEEP_REDACT_KEY_PATTERN` matching
  `password|token|accessToken|refreshToken|secret`, max depth 8, `req`/`res`/`error`/`err`
  passed through at depth 0 since pino's own `serializers` already handle those) applied via
  the `formatters.log` hook on all three services — for the RMQ services this walks the
  logged message payload/result directly (no `req`/`res` passthrough keys needed, since
  there's no HTTP request/response there).

**Custom serializers** (gateway only, HTTP-specific): `req` (masks sensitive query params
via `maskSensitiveQueryParams`/`REDACTED_QUERY_PARAM_KEYS`, derived from the redact-path
list), `error` (via `pino-http`'s `stdSerializers.err`).

**Auto-log level** (gateway only): same `resolveAutoLogLevel` rule — 5xx or thrown error →
`error`, 4xx → `warn`, else → `info` — since it inspects `res.statusCode`, which only
exists for HTTP.

**Health-check exclusion from auto-logging:**
- gateway: `autoLogging: { ignore: isHealthCheckRequest }`, matching
  `/health/users-service` and `/health/products-service` (the actual gateway health routes
  defined in `health.controller.ts` — different from the reference's single fixed path).
- users-service / products-service: `RmqContextInterceptor`'s auto-logging skips the
  `'health.check'` message pattern by name, mirroring the same intent (don't flood logs
  with routine health pings) via the RMQ-equivalent mechanism.

**Dev pretty-transport**: `pino-pretty`, same options as the reference (colorize,
single-line, `errorLikeObjectKeys: ['err', 'error']`), only activated when
`transport === 'pretty' && !isProduction` (from the new `logger` config namespace,
Section 4) — never enabled in production even if requested.

**Log level**: `trace` (non-production default) / `info` (production default), read from
the `logger` config namespace's `level` field.

## Config namespace, LoggerService/AppLogger API, Nest-logger bridge

**New `config/logger.config.ts` per service** — `registerAs('logger', ...)` + Zod,
following the exact pattern used by `app.config.ts`/`rabbitmq.config.ts`:

```ts
const loggerConfigSchema = z.object({
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default(isProduction ? 'info' : 'trace'),
  transport: z.enum(['json', 'pretty']).default('json'),
});
```
- `level` ← `LOG_LEVEL`
- `transport` ← `APP_LOG_TRANSPORT` (`'pretty'` maps to `'pretty'`, anything else/absent
  maps to `'json'`)
- `isProduction` comes from the new `config/environment.helper.ts` (reads `NODE_ENV` once;
  no config file outside it reads `NODE_ENV`/`LOG_LEVEL`/`APP_LOG_TRANSPORT` directly, per
  the project's existing rule that nothing outside the config module may read
  `process.env` directly).

**`LogChannel` taxonomy** — the reference's `'api' | 'jobs' | 'ws' | 'debounced-event-handler'`
doesn't fit this project (no jobs/websocket/event-handler concepts exist here). Each
service's own `core/logger/types.ts` defines:

```ts
export type LogChannel = 'http' | 'rmq' | 'bootstrap';
```

`'bootstrap'` covers lifecycle/startup logs outside any request context (`main.ts`,
uncaught-exception/unhandled-rejection handlers). gateway's `getLogger(source)` defaults to
`'http'`; the two RMQ services default to `'rmq'`.

Also carried over from the reference: `CORRELATION_ID_HEADER = 'x-correlation-id'`,
`CORRELATION_ID_ATTRIBUTE = 'correlationId'`, `REQUEST_ID_ATTRIBUTE = 'requestId'`.
**Dropped**: `SOURCE_REQUEST_ID_ATTRIBUTE`, `USER_ID_ATTRIBUTE` — nothing in this project
reads or sets them yet (no auth/JWT wired up), so keeping them would be speculative fields
with no producer or consumer.

**`LoggerService`/`AppLogger`** — identical shape to the reference:

```ts
class LoggerService {
  getLogger(source: string, channel: LogChannel = <service-default>): AppLogger;
}

class AppLogger {
  trace(fields: LogFields, message: string): void;
  debug(fields: LogFields, message: string): void;
  info(fields: LogFields, message: string): void;
  warn(fields: LogFields, message: string): void;
  error(fields: LogFields, message: string): void;
}
```

**`NestLoggerBridge`** — implements Nest's internal `LoggerService` interface
(`log`/`error`/`warn`/`debug`/`verbose`/`fatal`/`setLogLevels`), delegates to
`loggerService.getLogger('Nest', 'bootstrap')`. Wired into each `main.ts`:

```ts
const app = await NestFactory.create/createMicroservice(AppModule, { bufferLogs: true });
const loggerService = app.get(LoggerService);
app.useLogger(new NestLoggerBridge(loggerService.getLogger('Nest', 'bootstrap')));
```

This replaces the current bare `console.error` in each service's `bootstrap().catch(...)`
handler. Each `main.ts` also adds `process.on('uncaughtException' | 'unhandledRejection', ...)`
handlers using a root pino logger (`createRootLogger()`, a small helper exported alongside
`pinoConfigFactory` that builds a plain `pino()` instance from the same options), matching
the reference's top-level process handlers.

## Testing

Per `skills/testing-development.md` (Vitest, not the reference's Jest), all colocated under
`src/core/logger/` and `src/core/request-context/`, unit-only (`*.spec.ts` — nothing here is
an HTTP controller endpoint, so no `.int.spec.ts` is needed):

- `pino-config.factory.spec.ts` — level/transport selection, redaction (fixed paths +
  deep-redact), serializer masking, auto-log-level rules (gateway), health-check exclusion
  predicate
- `logger.service.spec.ts` / `app-logger.spec.ts` — `getLogger` binds `source`/`channel`;
  each level method forwards `fields` + `message` to the underlying `PinoLogger` call
- `request-context.service.spec.ts` — `run`/`setAttribute`/`getAttribute`/`getAttributes`
  isolation across concurrent async contexts
- gateway: `request-context.middleware.spec.ts` — generates an ID when the header is
  absent, reuses the header when present, echoes the response header
- users-service / products-service: `rmq-context.interceptor.spec.ts` — extracts the header
  from `RmqContext`, falls back to a generated ID when absent, skips auto-logging for
  `'health.check'`
- `nest-logger.bridge.spec.ts` — delegates each Nest logger method to the correct
  `AppLogger` level
- `logger.config.spec.ts` — mirrors the existing `app.config.spec.ts`/`rabbitmq.config.spec.ts`
  pattern: defaults, valid overrides, invalid values rejected by Zod

## Out of scope

- No AWS log shipping/aggregation (CloudWatch, etc.) — console/stdout JSON output only, per
  the project's "no new AWS services" rule.
- No user/auth-derived fields (`userId`) in log context — no auth exists yet in this
  project.
- No changes to `docker-compose.yml` — same env var injection pattern as the config module
  (it already passes through arbitrary env vars).
- `.env.example` files (all three services) get the two new vars documented:
  `LOG_LEVEL`, `APP_LOG_TRANSPORT`. No `.env` file is created or committed.
- No retry/dead-letter/queue-durability changes — this task only adds logging around the
  existing RabbitMQ call sites, it does not change transport behavior.
