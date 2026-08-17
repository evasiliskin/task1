# api-gateway

The system's only HTTP surface. It validates incoming requests, translates them into RabbitMQ
messages, and shapes every reply into the standard response envelope.

See the [root README](../../README.md) for the system architecture and the shared RabbitMQ
conventions.

## Responsibilities

- Terminate HTTP: global prefix `api`, URI versioning (`/api/v1/...`), Swagger UI at `/api-docs`
  when `SWAGGER_ENABLED` is on (default: on outside production).
- Validate requests and responses against Zod contracts.
- Translate HTTP → RabbitMQ (RPC or event) and back, including error status codes.
- Rate limiting, Helmet, correlation-ID propagation, aggregated health reporting.
- Own the upload path: receive multipart archives, verify they are really gzip, place them in the
  shared archive directory, and sweep orphans.

It holds **no domain logic and no database**. Every decision beyond request shaping belongs to
`service-a` or `service-b`.

## Externally visible surface

| Route                                                 | Transport out                               | Pattern                                       | Peer      |
| ----------------------------------------------------- | ------------------------------------------- | --------------------------------------------- | --------- |
| `POST /api/v1/imports`                                | emit (+ RPC when `Idempotency-Key` is sent) | `archive.import.download` (+ `imports.claim`) | service-a |
| `POST /api/v1/imports/upload`                         | emit                                        | `archive.process.upload`                      | service-a |
| `GET /api/v1/imports/:importId`                       | RPC                                         | `imports.status.get`                          | service-a |
| `GET /api/v1/events`                                  | RPC                                         | `events.search`                               | service-a |
| `GET /api/v1/logs`                                    | RPC                                         | `logs.search`                                 | service-b |
| `GET /api/v1/stats`                                   | RPC                                         | `stats.get`                                   | service-b |
| `GET /api/v1/reports/pdf`                             | RPC, then streams the file                  | `reports.pdf.generate`                        | service-b |
| `GET /api/v1/health`, `/health/live`, `/health/ready` | RPC ping                                    | `health.check`                                | both      |

Health routes are `@Public()` and skip throttling. `/health` always returns 200 with a `status` of
`ok` or `degraded`; `/health/ready` returns 503 unless RabbitMQ, both services and Redis are up.

## Request pipeline

Ordering matters and is set up in `main.ts` / `app.module.ts`:

1. `NestFactory.create(..., { bodyParser: false })` — the body parsers are applied _after_ the
   request-context middleware so every parse error already has a correlation ID.
2. Request-context middleware → Helmet → Express `json`/`urlencoded`.
3. Global guards: `ThrottlerGuard`, then `AuthGuard`.
4. Global interceptors: `ContractValidationInterceptor` (validates the handler's return value) and
   `ResponseEnvelopeInterceptor` (wraps it; `StreamableFile` passes through unwrapped).
5. Global filter: `GlobalExceptionFilter` renders the error envelope.

### Contract-first validation

There is **no global `ValidationPipe`**. Instead each HTTP handler declares
`@Contract({ request, response })` and binds its input with `@ModelBinder(Schema)`:

- Request schemas are strict Zod objects keyed by `params` / `query` / `body`; the binder merges the
  parsed sections into one flat object and raises `RequestContractViolationError` (HTTP 400 with
  per-field details) on failure.
- The response schema is enforced at runtime by the interceptor; a mismatch is a 500
  `ResponseContractViolationError`, not a silently wrong payload.
- `ContractScanner` walks every controller at startup and **fails the boot** if any HTTP handler is
  missing `@Contract`. Adding an endpoint without a contract is not possible.
- The same Zod schemas generate the Swagger response schemas via `@ApiSingleResponse` /
  `@ApiListResponse`.

### Response envelope

All JSON responses are enveloped — `{ status, code, message, result: { data | items, pagination },
meta: { tracing: { correlationId } } }` for success, and
`{ status: 'FAILED', code, reason, message, details, meta }` for errors. The PDF route is the sole
exception: it returns a `StreamableFile` and is not wrapped.

## Dependencies

- **RabbitMQ** — three `ClientProxy` instances (`SERVICE_A_RMQ_CLIENT`,
  `SERVICE_A_IMPORTS_RMQ_CLIENT`, `SERVICE_B_RMQ_CLIENT`), registered with `noAssert: true` so the
  gateway never declares the consumers' queues. All calls go through `ContextPropagatingClient`.
- **Redis** — throttler storage and a health ping. Not used as a cache.
- **`STORAGE_DIR`** — shared with service-a. The gateway writes `<uuid>.upload.tmp`, then renames to
  `<uuid>.json.gz` once the gzip magic bytes check out, and `UploadCleanupService` periodically
  removes only upload-temp and final-archive files older than `UPLOAD_RETENTION_MS`.
- **`REPORT_DIR`** — shared with service-b, read-only here. The gateway asserts the returned path is
  inside the configured directory before streaming it.
- **`@task1/shared`** — envelope, exception handling, request context, logging, health indicators.

## Authentication

`AuthGuard` is global but its `isAuthenticated()` unconditionally returns `true`: **every endpoint
is currently open**. The surrounding structure (`@Public()` metadata, `UnauthenticatedError`, the
`IRequestWithUser` shape) exists so a real provider can be dropped into that one method. Do not
treat the guard as a security control.

## Configuration

| Variable                                         | Default                                    | Purpose                                                  |
| ------------------------------------------------ | ------------------------------------------ | -------------------------------------------------------- |
| `PORT`                                           | `3000`                                     | HTTP port                                                |
| `RABBITMQ_URL`                                   | localhost (required in production)         | Broker                                                   |
| `RABBITMQ_SERVICE_A_QUEUE`                       | `service_a_queue`                          | service-a RPC queue                                      |
| `RABBITMQ_SERVICE_A_IMPORTS_QUEUE`               | `service_a_imports_queue`                  | service-a import queue                                   |
| `RABBITMQ_SERVICE_B_QUEUE`                       | `service_b_queue`                          | service-b queue                                          |
| `RABBITMQ_RPC_TIMEOUT_MS`                        | `10000`                                    | Per-RPC timeout                                          |
| `RABBITMQ_PING_TIMEOUT_MS`                       | `3000`                                     | Health-ping timeout                                      |
| `REDIS_URL`                                      | localhost (required in production)         | Throttler storage + health                               |
| `REDIS_PING_TIMEOUT_MS`                          | `3000`                                     | Health-ping timeout                                      |
| `STORAGE_DIR`                                    | `./data/archives` (required in production) | Shared archive directory                                 |
| `REPORT_DIR`                                     | `./data/reports` (required in production)  | Shared report directory                                  |
| `UPLOAD_MAX_FILE_SIZE_BYTES`                     | `536870912`                                | Multer limit                                             |
| `UPLOAD_RETENTION_MS`                            | `86400000` (min 600000)                    | Orphaned-upload retention                                |
| `UPLOAD_SWEEP_INTERVAL_MS`                       | `900000`                                   | Sweep interval                                           |
| `THROTTLE_TTL_MS` / `THROTTLE_LIMIT`             | `60000` / `100`                            | Global rate limit                                        |
| `THROTTLE_UPLOAD_LIMIT`                          | `5`                                        | Rate limit for `POST /imports/upload`                    |
| `SWAGGER_ENABLED`                                | on outside production                      | Serves `/api-docs`; only the literal `"true"` enables it |
| `SERVICE_NAME`, `LOG_LEVEL`, `APP_LOG_TRANSPORT` | `api-gateway`, `trace`/`info`, `json`      | Logging                                                  |

`.env` files are not read — see the root README's Configuration section.

## Running and testing

```bash
pnpm dev:api-gateway                       # from the repo root, watch mode
pnpm --filter api-gateway run test         # unit + HTTP integration (Supertest, clients mocked)
pnpm --filter api-gateway run test:cov
pnpm --filter api-gateway run lint
```

`@task1/shared` must be built first (`pnpm build` at the root). The gateway starts without RabbitMQ
or Redis; it will simply report `degraded` health and fail RPC-backed routes until they are up.
There is no `test:int` script here — the `*.int.spec.ts` files run in-process as part of `test`.
