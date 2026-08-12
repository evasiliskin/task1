# task1

pnpm workspace monorepo: an Angular front-end and NestJS microservices back-end.

```
task1/
├── front-end/              Angular app (talks only to the gateway's REST API)
└── back-end/
    ├── gateway/             Public HTTP entrypoint - REST API, forwards to microservices over RabbitMQ
    ├── service-a/           Internal microservice (RabbitMQ transport only, no HTTP)
    └── service-b/           Internal microservice (RabbitMQ transport only, no HTTP)
```

## Architecture

The gateway is the only HTTP surface. It receives REST requests, validates them, and forwards to
the internal microservices over NestJS's RabbitMQ transport using `ClientProxy` /
`@MessagePattern`. `service-a` and `service-b` expose no HTTP at all — they're reachable only as
RabbitMQ consumers.

```
Angular (front-end)
      │  HTTP (REST)
      ▼
   gateway  ──RabbitMQ RPC──▶  service-a  ──RabbitMQ RPC──▶  service-b
```

Every request through this chain carries a `correlationId` (stable for the whole flow) and a
`requestId` (fresh per hop) — see "Correlation ID & Request ID" below.

## Getting started

```bash
pnpm install

# start RabbitMQ + service-a + service-b + gateway + front-end
pnpm docker:up

# or run services individually against a local RabbitMQ:
cp back-end/gateway/.env.example back-end/gateway/.env
cp back-end/service-a/.env.example back-end/service-a/.env
cp back-end/service-b/.env.example back-end/service-b/.env

pnpm dev:service-b
pnpm dev:service-a
pnpm dev:gateway
pnpm dev:front-end
```

- Front-end: http://localhost:4200
- Gateway REST API: http://localhost:3000 (health checks at `/health/service-a`, `/health/service-b`)
- RabbitMQ management UI: http://localhost:15672 (guest/guest)
- `service-a`/`service-b`: internal only, reachable over RabbitMQ (not exposed to the browser)

## Common tasks

| Command | What it does |
| --- | --- |
| `pnpm build` | Build every workspace package |
| `pnpm test` | Run every package's tests (Vitest for all three back-end services) |
| `pnpm lint` | Lint the back-end services (ESLint) |
| `pnpm format` / `pnpm format:check` | Prettier across the whole workspace |
| `pnpm check` | `lint` + `test` - also runs automatically on `git push` (Husky) |
| `pnpm docker:up` / `pnpm docker:down` | Start/stop RabbitMQ and all three back-end services + front-end |

## Tooling notes

- **Package manager**: pnpm workspaces (`pnpm-workspace.yaml`: `front-end`, `back-end/*`).
- **Testing**: Vitest for all three NestJS services (`*.spec.ts` unit tests, `*.int.spec.ts`
  HTTP-integration tests for the gateway via `supertest`).
- **Prettier**: one shared config at the repo root (`.prettierrc.mjs`), applies to every package.
- **ESLint**: `back-end/gateway`, `back-end/service-a`, and `back-end/service-b` each have their
  own `eslint.config.mjs` (typescript-eslint + import ordering + security/sonarjs/unicorn rules),
  pointed at each app's own `tsconfig.json`. `front-end` doesn't use this config - it's
  Node/NestJS-specific tooling; add `@angular-eslint` separately if you want linting there.
- **Git hooks**: Husky runs `pnpm check` (lint + test) on `git push`, not on every commit -
  `.husky/pre-push`. Hooks install automatically the first time you run `pnpm install` (the root
  `prepare` script).
- **No persistence layer yet** - all three back-end services are stateless; a database will be
  added back once a concrete need is decided (see `CLAUDE.md`).

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
curl -i http://localhost:3000/health/service-a \
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
curl -i http://localhost:3000/health/service-a \
  -H "X-Correlation-ID: 11111111-1111-4111-8111-111111111111"
```

Expected: `503`, with the same `x-correlation-id` you sent still present on the error response.

See `docs/superpowers/specs/2026-08-12-correlation-request-id-design.md` for the full design.
