# Users/products health-check microservices over RabbitMQ — Design

Date: 2026-08-11

Supersedes: `2026-08-11-health-check-microservices-design.md` (that doc proposed
renaming `users-service` → `internal-service` with a single internal service;
this doc keeps the `users-service` name and adds a second service,
`products-service`).

## Goal

Two minimal NestJS microservices — `users-service` and `products-service` —
each exposing nothing but a RabbitMQ `health.check` message handler. The
`gateway` is the only HTTP entrypoint and exposes one health route per
service, each doing a real RPC round-trip over RabbitMQ. All existing
CRUD/Prisma/TCP-transport code is removed; valid business logic will be added
back later.

## Architecture

```
Angular (front-end)
      │ HTTP
      ▼
   gateway ──HTTP GET /health/users-service─────▶┐
      │                                           │ RabbitMQ RPC (health.check)
      │──HTTP GET /health/products-service───────▶│
      ▼                                           ▼
                                    users-service / products-service
                               (RMQ consumer only, no HTTP listener)
```

- **gateway** (`back-end/gateway`): NestJS HTTP app. Two routes,
  `GET /health/users-service` and `GET /health/products-service`, implemented
  with `@nestjs/terminus`. Each sends an RPC message to the corresponding
  service over RabbitMQ and reports its status.
- **users-service** (`back-end/users-service`): NestJS **microservice only**
  (`NestFactory.createMicroservice`, no HTTP listener). Listens on its
  RabbitMQ queue for the `health.check` message pattern, replies
  `{ status: 'ok' }`. All current CRUD code (controller, module, DTOs,
  mapper, patterns, the `NotImplementedError`-stubbed service) is deleted.
- **products-service** (`back-end/products-service`, new): scaffolded fresh
  with the same tooling as `users-service` (package.json, tsconfig, eslint,
  vitest, Dockerfile), same structure — microservice only, single
  `health.check` handler.

## RabbitMQ messaging contract

- Queues: `users_service_queue` and `products_service_queue`, durable.
  Standard NestJS RMQ request/reply (auto reply queue).
- Message pattern: `health.check`, payload `{}`.
- Response: `{ status: 'ok' }`.
- Env vars:
  - `users-service` / `products-service`: `RABBITMQ_URL`, `RABBITMQ_QUEUE`
    (own queue name).
  - `gateway`: `RABBITMQ_URL`, `RABBITMQ_USERS_QUEUE`,
    `RABBITMQ_PRODUCTS_QUEUE`.

## Gateway health check (Terminus)

Use `@nestjs/terminus`'s `HealthCheckService` for the endpoint shape/status
codes, combined with one reusable **custom health indicator** that does a
real RPC round-trip — not Terminus's built-in
`MicroserviceHealthIndicator.pingCheck`, which only verifies RabbitMQ broker
connectivity and would report healthy even if the target service itself had
crashed.

- `RabbitMqPingHealthIndicator` (custom, `HealthIndicatorService` pattern per
  Terminus v11+): method takes a `ClientProxy` and a key; sends
  `health.check`, awaits the reply via
  `firstValueFrom(...pipe(timeout(3000)))`, calls `indicator.up()` on success
  or `indicator.down()` on error/timeout. Shared by both routes — no
  per-service subclass.
- `ClientsModule` registers two named RMQ clients:
  `USERS_SERVICE_RMQ_CLIENT`, `PRODUCTS_SERVICE_RMQ_CLIENT`.
- `HealthController`:
  - `GET /health/users-service` → `health.check([() => indicator.isHealthy('users-service', usersClient)])`
  - `GET /health/products-service` → `health.check([() => indicator.isHealthy('products-service', productsClient)])`
- Terminus returns its standard envelope on success (`200 { status: 'ok', info: {...}, error: {}, details: {...} }`)
  and throws its native `ServiceUnavailableException` on failure. This
  already flows through the existing `GlobalExceptionFilter` →
  `HttpExceptionFormatStrategy` (matches on `instanceof HttpException`) — no
  new `AppException` subclass needed.

## Docker Compose

Remove:
- `postgres` service, `postgres-data` volume, `DATABASE_URL` anchor.
- All users CRUD code references; no service exposes a DB connection.

Add:
- `rabbitmq` service, image `rabbitmq:3-management-alpine`, ports `5672`
  (AMQP) and `15672` (management UI, guest/guest), with a healthcheck.
- `products-service`, built the same way as `users-service`.

Service configs:
- `gateway`: exposes port `3000`; env `RABBITMQ_URL`,
  `RABBITMQ_USERS_QUEUE`, `RABBITMQ_PRODUCTS_QUEUE`, `PORT`;
  `depends_on: rabbitmq (service_healthy)`.
- `users-service` / `products-service`: no exposed port; env `RABBITMQ_URL`,
  `RABBITMQ_QUEUE`; `depends_on: rabbitmq (service_healthy)`.

Resulting URLs:
- `http://localhost:3000/health/users-service`
- `http://localhost:3000/health/products-service`
- RabbitMQ management UI: `http://localhost:15672` (guest/guest)

## Error handling

Keep `AppError` (base) and `InternalError` (generic fallback, per the
project-wide "never throw raw Error" rule) in all three services. Delete
everything CRUD-specific: `ConflictError`, `VersionMismatchError`,
`AlreadyExistsError`, `ValidationError`, `EntityNotFoundError`,
`NotFoundError`, and the currently-uncommitted `NotImplementedError`. Update
each `core/errors/index.ts` barrel accordingly.

## Renaming

None. `users-service` keeps its name; `products-service` is new;
`gateway` keeps its name.

## Dependencies

- Add to `users-service` and `products-service`: `amqp-connection-manager`,
  `amqplib` (required by `@nestjs/microservices` RMQ transport).
- Add to `gateway`: `@nestjs/terminus`, `amqp-connection-manager`, `amqplib`.
- Remove Prisma deps/client from `users-service` (already partially removed
  in the working tree; this finishes the job).

## Testing

- `users-service` / `products-service`: unit spec for the health message
  handler, asserting it returns `{ status: 'ok' }`.
- `gateway`: unit spec for `RabbitMqPingHealthIndicator` covering (a) target
  service healthy → `indicator.up()`, (b) RMQ timeout/error →
  `indicator.down()` (mocking `ClientProxy`). Spec for `HealthController`
  covering 200 vs 503 for both routes.
- Delete now-obsolete specs tied to deleted CRUD code
  (`users.service.spec.ts`); rewrite `health.controller.int.spec.ts` and the
  deleted `health.controller.spec.ts` for the new two-route implementation.

## Out of scope

- Fixing/updating the Angular front-end's calls to the removed `/users`
  endpoints.
- Any persistence layer (per CLAUDE.md, deferred until explicitly decided).
- Any RabbitMQ topology beyond two single request/reply queues (no
  exchanges, no fanout, no DLQ).
