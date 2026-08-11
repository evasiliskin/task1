# task1

pnpm workspace monorepo: an Angular front-end and NestJS microservices back-end.

```
task1/
├── front-end/              Angular app (talks only to the gateway's REST API)
└── back-end/
    ├── gateway/             Public HTTP entrypoint - REST API, forwards to microservices over TCP
    └── users-service/       Users domain microservice (TCP transport, Prisma + PostgreSQL)
```

## Architecture

The gateway is the only HTTP surface. It receives REST requests, validates
them, and forwards to internal microservices over NestJS's TCP transport
using `ClientProxy` / `@MessagePattern` (see
[the NestJS microservices overview](https://slides.com/yariv-gilad/nest-js-microservices)
for the pattern this follows). Internal services expose no HTTP at all.

```
Angular (front-end)
      │  HTTP (REST)
      ▼
gateway  ── TCP / @MessagePattern ──▶  users-service ── Prisma ──▶ PostgreSQL
```

This keeps services loosely coupled without requiring a message broker
(Redis, RabbitMQ, Kafka) for a project this size - TCP is the simplest
transport NestJS supports. If you outgrow direct TCP later (e.g. you need
pub/sub or delivery guarantees), swap the `Transport.TCP` options for
Redis/RabbitMQ in `back-end/*/src/main.ts` and `*/src/*/*.module.ts` without
changing controllers or services.

Adding a new microservice: copy `back-end/users-service` as a template,
give it its own Prisma schema/database, define its own `@MessagePattern`s,
and register a matching `ClientsModule` entry + controller in the gateway.

## Error handling

Both back-end services share one error-handling pattern (ported from an
existing project at `d:\Dev\tensi-backend`, trimmed to this project's needs -
no i18n or request-context layer here):

- `core/errors/` - `AppError` abstract base class with `code`/`category`,
  and concrete errors grouped by category (`NotFoundError`, `ConflictError`,
  `ValidationError`, `InternalError`). Business logic throws these, never a
  raw `Error`.
- `core/exception-handling/` - a strategy-based `ErrorFormatService`
  (`AppErrorFormatStrategy`, `HttpExceptionFormatStrategy`,
  `DefaultFormatStrategy`) turns any exception into a consistent
  `{ statusCode, error: { code, category, message, details } }` shape.
- **gateway**: `GlobalExceptionFilter` (HTTP) writes that shape as the JSON
  response, plus a `correlationId`/`timestamp`/`path`.
- **users-service**: `RpcAppExceptionFilter` flattens the same shape into a
  plain object before it crosses the TCP boundary (class instances don't
  survive serialization). The gateway's `SerializedRpcErrorFormatStrategy`
  recognizes that shape and maps it straight through, so an
  `EntityNotFoundError` thrown in users-service still becomes an HTTP 404 at
  the gateway.

## Getting started

```bash
pnpm install

# start PostgreSQL for users-service
pnpm docker:up

# copy env files and adjust if needed
cp back-end/gateway/.env.example back-end/gateway/.env
cp back-end/users-service/.env.example back-end/users-service/.env

# create the users-service database schema
pnpm --filter users-service run prisma:migrate:dev

# run everything (each in its own terminal)
pnpm dev:users-service
pnpm dev:gateway
pnpm dev:front-end
```

- Front-end: http://localhost:4200
- Gateway REST API: http://localhost:3000/v1 (health check at `/health`)
- users-service: internal only, TCP port 3001 (not exposed to the browser)

## Common tasks

| Command | What it does |
| --- | --- |
| `pnpm build` | Build every workspace package |
| `pnpm test` | Run every package's tests (Vitest for both back-end services) |
| `pnpm lint` | Lint the back-end services (ESLint, ported from tensi-backend) |
| `pnpm format` / `pnpm format:check` | Prettier across the whole workspace |
| `pnpm check` | `lint` + `test` - also runs automatically on `git push` (Husky) |
| `pnpm docker:up` / `pnpm docker:down` | Start/stop the local PostgreSQL container |

## Tooling notes

- **Package manager**: pnpm workspaces (`pnpm-workspace.yaml`: `front-end`, `back-end/*`).
- **Testing**: Vitest for both NestJS services (`*.spec.ts` unit tests, `*.e2e-spec.ts`
  end-to-end tests for the gateway's HTTP layer).
- **Prettier**: one shared config at the repo root (`.prettierrc.mjs`), ported
  from tensi-backend, applies to every package.
- **ESLint**: `back-end/gateway` and `back-end/users-service` each have their
  own `eslint.config.mjs`, ported from tensi-backend's flat config
  (typescript-eslint + import ordering + security/sonarjs/unicorn rules),
  pointed at each app's own `tsconfig.json`. `front-end` doesn't use this
  config - it's Node/NestJS-specific tooling; add `@angular-eslint` separately
  if you want linting there.
- **Git hooks**: Husky runs `pnpm check` (lint + test) on `git push`, not on
  every commit - `.husky/pre-push`. Hooks install automatically the first
  time you run `pnpm install` (the root `prepare` script).
- **Optimistic concurrency**: `User` rows carry a `version` column;
  `PATCH /v1/users/:id` requires the caller's current `version` and returns
  409 Conflict if it's stale.
