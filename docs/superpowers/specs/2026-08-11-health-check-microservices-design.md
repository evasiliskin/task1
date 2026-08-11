# Health-check microservices over RabbitMQ — Design

Date: 2026-08-11

## Goal

Replace the existing `gateway` + `users-service` (CRUD, Prisma, TCP transport) with two very simple NestJS microservices that only expose a health check, communicating with each other over RabbitMQ. Run everything via Docker Compose.

## Architecture

```
Angular (front-end)
      │ HTTP
      ▼
  gateway  ──HTTP GET /health──▶ (caller)
      │
      │ RabbitMQ RPC (health.check message)
      ▼
 internal-service (no HTTP listener, RMQ consumer only)
```

- **gateway** (`back-end/gateway`): NestJS HTTP app. Single route `GET /health`, implemented with `@nestjs/terminus`. The check sends an RPC message to `internal-service` over RabbitMQ and reports the combined status.
- **internal-service** (`back-end/users-service` renamed): NestJS **microservice only**, created with `NestFactory.createMicroservice` (no HTTP listener). Listens on a RabbitMQ queue for the `health.check` message pattern and replies `{ status: 'ok' }`.

Both services drop all current CRUD/Prisma/TCP-transport code.

## RabbitMQ messaging contract

- Queue: `internal_service_queue`, durable. Standard NestJS RMQ request/reply (auto reply queue).
- Message pattern: `health.check`, payload `{}`.
- Response: `{ status: 'ok' }`.
- Connection: `RABBITMQ_URL` env var (`amqp://guest:guest@rabbitmq:5672`) and `RABBITMQ_QUEUE` (`internal_service_queue`), same values in both services.

## Gateway health check (Terminus)

Use `@nestjs/terminus`'s `HealthCheckService` for the endpoint shape/status codes, combined with a **custom health indicator** that does a real RPC round-trip — not Terminus's built-in `MicroserviceHealthIndicator.pingCheck`, which only verifies RabbitMQ broker connectivity and would report healthy even if `internal-service` itself had crashed.

- `InternalServiceHealthIndicator` (custom, `HealthIndicatorService` pattern per Terminus v11+): injects the `RABBITMQ_CLIENT` `ClientProxy` and `HealthIndicatorService`. `isHealthy(key)` sends `health.check`, awaits the reply via `firstValueFrom(...pipe(timeout(3000)))`, calls `indicator.up()` on success or `indicator.down()` on error/timeout.
- `HealthController`: `GET /health`, `@HealthCheck()`, calls `health.check([() => internalServiceHealthIndicator.isHealthy('internal-service')])`.
- Terminus returns its standard envelope on success (`200 { status: 'ok', info: {...}, error: {}, details: {...} }`) and throws its native `ServiceUnavailableException` (a plain `HttpException`) on failure.
- No new `AppException` subclass is needed: `ServiceUnavailableException` already flows through the existing `GlobalExceptionFilter` → `HttpExceptionFormatStrategy` (it matches on `instanceof HttpException`), producing the app's standard error envelope (`statusCode`, `error`, `correlationId`, `timestamp`, `path`) automatically.

## Docker Compose

Remove:
- `postgres` service, `postgres-data` volume, `DATABASE_URL` anchor.
- Prisma package, `prisma/` folder, Prisma module/service in internal-service.
- All users CRUD code (controllers, DTOs, mapper, message patterns) in both services.
- TCP `@nestjs/microservices` client config in gateway.

Add:
- `rabbitmq` service, image `rabbitmq:3-management-alpine`, ports `5672` (AMQP) and `15672` (management UI, guest/guest), with a healthcheck.

Keep:
- `front-end` service as-is. Its existing calls to `/users` endpoints will have nothing to call — out of scope for this change.

Service configs:
- `gateway`: exposes port `3000`, env `RABBITMQ_URL`, `RABBITMQ_QUEUE`, `PORT`; `depends_on: rabbitmq (service_healthy)`.
- `internal-service`: no exposed port, env `RABBITMQ_URL`, `RABBITMQ_QUEUE`; `depends_on: rabbitmq (service_healthy)`.

Resulting URLs:
- Gateway health check: `http://localhost:3000/health`
- RabbitMQ management UI: `http://localhost:15672` (guest/guest)

## Error handling

Keep `AppException` base and the global exception filter infrastructure (`core/errors`, `core/exception-handling`) as-is — it already handles Terminus's `ServiceUnavailableException` generically via `HttpExceptionFormatStrategy`, so no new exception class is required. Trim to only what's used:
- Keep: `AppError` (base), `InternalError` (generic fallback for the project-wide "never throw raw Error" rule).
- Delete: `ConflictError`, `VersionMismatchError`, `AlreadyExistsError`, `ValidationError`, `EntityNotFoundError`, `NotFoundError` (all CRUD-specific, unused once users CRUD is removed).
- Update `core/errors/index.ts` barrel exports accordingly.

## Renaming

- `back-end/users-service` → `back-end/internal-service` (directory, `package.json` name, `nest-cli.json`, Dockerfile path in `docker-compose.yml`, root `package.json` script `dev:users-service` → `dev:internal-service`).
- `back-end/gateway` keeps its name.

## Dependencies

- Add to both services: `amqp-connection-manager`, `amqplib` (required by `@nestjs/microservices` RMQ transport).
- Add to `gateway` only: `@nestjs/terminus`.
- Remove Prisma deps/client from internal-service.

## Testing

- `gateway`: unit spec for `InternalServiceHealthIndicator` covering (a) internal-service healthy → `indicator.up()`, (b) RMQ timeout/error → `indicator.down()`. Unit/integration spec for `health.controller` covering 200 vs 503 responses (mocking the health indicator). Mock the `ClientProxy`.
- `internal-service`: unit spec for the health message handler, asserting it returns `{ status: 'ok' }`.
- Remove now-obsolete specs tied to deleted CRUD code (`users.service.spec.ts`); `health.controller.spec.ts` gets rewritten, not deleted; existing `health.controller.int.spec.ts` gets reconciled with the new implementation.

## Out of scope

- Fixing/updating the Angular front-end's calls to the removed `/users` endpoints.
- Any persistence layer (per CLAUDE.md, deferred until explicitly decided).
- Any RabbitMQ topology beyond the single request/reply queue (no exchanges, no fanout, no DLQ).
