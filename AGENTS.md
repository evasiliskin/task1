# AGENTS.md

Rules for AI coding agents working in this repository. Architecture and setup live in
[README.md](README.md) and the per-service READMEs — read those first; this file only lists the
constraints that are easy to violate.

## Layout

```text
back-end/
  api-gateway/        HTTP surface only. No domain logic, no database.
  service-a/          GH Archive ingestion + event search. RabbitMQ only.
  service-b/          Processing log, stats, PDF reports. RabbitMQ only.
  libs/shared/        @task1/shared — infrastructure + message contracts. No business rules.
docker-compose.yml    Local infrastructure + all three services.
```

pnpm workspace (`back-end/*`, `back-end/libs/*`). ESM throughout: **relative imports must carry the
`.js` extension**, `@task1/shared/...` subpath imports must not.

## Service boundaries

- A service never imports another service's source. The only shared code is `@task1/shared`.
- No cross-service database access. `service-a` owns Mongo `service_a`, `service-b` owns
  `service_b`, the gateway owns no database at all.
- The gateway must not grow domain logic, queries, or persistence. If a request needs a decision,
  add an RPC pattern and make the owning service decide.
- Services talk over RabbitMQ only — never HTTP. The only outbound HTTP in the system is service-a
  fetching `data.gharchive.org`.

## Shared library rules

`@task1/shared` may contain: message pattern constants, event/DTO contracts, error types, NestJS
cross-cutting modules (logging, request context, exception handling, response envelope, health,
metrics, messaging topology), and shared conventions such as `storage/archive-paths.ts` and the
pagination cursor codec.

It must not contain business rules. Import counting, stats derivation, report content, filter
building and search logic stay in the owning service. If shared code starts branching on a domain
concept, it is in the wrong package.

Services import from `@task1/shared` two ways: the root barrel (`src/index.ts`, used for small
leaf utilities such as `requireInProduction` and the pagination constants) and deep subpaths such as
`@task1/shared/logger/logger.service` (used for everything else, including the Nest modules, which
are deliberately _not_ re-exported from the barrel). Follow whichever the surrounding code uses; add
to `src/index.ts` only when the new export belongs in the barrel group.

## Messaging rules

- Add or rename patterns only in `@task1/shared`, in the constant group matching the transport kind:
  `messaging/rpc-patterns.const.ts` (`RPC_PATTERNS`, consumed with `@MessagePattern` via `send`/RPC),
  `messaging/command-patterns.const.ts` (`COMMAND_PATTERNS`, consumed with `@EventPattern` — a
  fire-and-forget instruction to do work, e.g. `archive.import.download`), or
  `github-archive/events/event-patterns.const.ts` (`EVENT_PATTERNS`, also `@EventPattern` — a
  past-tense notification that something already happened, e.g. `github.import.completed`). Never
  hard-code a pattern string.
- Choose deliberately: `send`/`@MessagePattern` for anything the caller waits on,
  `emit`/`@EventPattern` for work and notifications. Gateway publishes go through
  `sendRpcMessage` / `publishImportMessage`, which apply the `rpcTimeoutMs` timeout and wrap
  transport failures — do not call the client directly.
- Every publish goes through `ContextPropagatingClient`. Calling a raw `ClientProxy` drops
  `x-correlation-id` and silently breaks the trace.
- Every consumer re-validates its payload with a Zod schema. Malformed payloads are logged and
  acked, never retried.
- Consumers use manual ack (`noAck: false`). RPC handlers ack in `finally`; event handlers ack on
  success and delegate failures to `RetryPublisher`. Never leave a path that neither acks nor nacks.
- There are no custom exchanges. Queue naming is `<queue>`, `<queue>.retry`, `<queue>.dlq`, derived
  by `deriveQueueTopology`. Main queues are declared by the transport options in each service's
  `main.ts`, the retry/DLQ pair by `MessagingModule`'s bootstrap initializer — do not add a third
  declaration site. The gateway's clients use `noAssert: true` and must keep doing so.
- A pattern's payload shape is owned by the consumer's schema; changing it means changing both sides
  in the same commit.

## Code structure

There is no repository/ORM layer and none should be introduced. The actual shape is:

```text
controller (@MessagePattern / @EventPattern / HTTP)
  → service (DI, config, wiring)
    → plain exported functions (the logic, unit-testable without Nest)
      → mongodb driver collection providers
```

Prefer adding a pure function plus a thin service over a new stateful class. Collections are exposed
through `*-collection.provider.ts` tokens injected into services.

Gateway-specific: every HTTP handler needs `@Contract({ request, response })` — `ContractScanner`
fails startup otherwise — and binds its input with `@ModelBinder(Schema)` unless it takes none. Do
not add a global `ValidationPipe`; validation is Zod.

## Configuration

`ConfigModule` runs with `ignoreEnvFile: true` — `.env` is never loaded, so a new variable must be
added to the service's `config/*.ts` Zod schema, to `.env.example`, and to `docker-compose.yml` if
the stack needs it. Use `requireInProduction` for anything that must not silently fall back.

## Logging

pino via `@task1/shared/logger`, never `nestjs-pino` and never `console`. Call
`loggerService.getLogger(Name)` and pass `(fields, message, error?)` — the `LogFields` type rejects
an `Error` in the fields object; errors go in the third argument.

## Testing

- Unit tests are `*.spec.ts` colocated with the source; `test:cov` gates on 90% lines/branches.
- Gateway HTTP tests are `src/**/*.int.spec.ts` (Supertest, RabbitMQ clients mocked) and run with
  the unit suite.
- `test/int/*.int.spec.ts` in service-a/service-b use Testcontainers and only run via `test:int`.
  Do not put container-based tests in the unit suite.

## Commands

```bash
pnpm install
pnpm build                                  # required before running a service: @task1/shared resolves to dist/
pnpm docker:up / pnpm docker:down
pnpm dev:api-gateway | dev:service-a | dev:service-b
pnpm test                                   # all packages, no infrastructure
pnpm test:int                               # service-a/service-b, needs Docker
pnpm lint
pnpm check                                  # lint + test; also runs on git push
pnpm --filter <package> run <script>        # single package
```

Run `pnpm check` before considering a change done.

## Do not change without being asked

- The `AuthGuard` stub (`isAuthenticated()` returning `true`) — it is an intentional placeholder.
- `.json.gz` as the stored archive suffix — every reader gunzips, and the gateway validates uploads
  by magic bytes, not by name.
- Docker, infrastructure, or the queue topology.

## Library documentation

Before writing code against NestJS, RabbitMQ/amqplib, MongoDB's driver, ioredis, Zod, Vitest, pino
or any other dependency, fetch current documentation with **Context7** (`npx ctx7@latest library
"<name>" "<question>"`, then `npx ctx7@latest docs <libraryId> "<question>"`) rather than relying on
training data. This repository pins recent majors — NestJS 11, Zod 4, Vitest 4, pino 10, ioredis 6,
mongodb 7 — where remembered APIs are frequently wrong.
