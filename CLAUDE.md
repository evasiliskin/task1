# CLAUDE.md

Read [AGENTS.md](AGENTS.md) first — it holds the architecture rules (service boundaries, shared
library scope, messaging conventions, commands). This file adds only what matters when changes are
made automatically, at speed, across many files.

## Before you start

Check the owning service before editing. A change that looks local usually is not:

- A pattern string, event payload or view DTO lives in `@task1/shared` and has a producer **and** a
  consumer. Grep both before touching either.
- A config value usually appears in four places: `config/*.ts`, `.env.example`,
  `docker-compose.yml`, and the service README's configuration table.
- `STORAGE_DIR` and `REPORT_DIR` are shared between two services. Changing how one side names,
  writes or sweeps files breaks the other; the ownership split is by filename suffix
  (`@task1/shared/storage/archive-paths.ts`).

## Contracts are enforced at runtime

Several invariants fail loudly instead of silently, so a "small" edit can break startup:

- Every gateway HTTP handler must carry `@Contract({ request, response })` — `ContractScanner`
  throws at bootstrap if one is missing.
- Handler return values are validated against the response schema; changing a controller's return
  shape without updating its Zod schema produces a 500, not a changed payload.
- Every config module parses its input with Zod at boot; an unparseable value stops the process.

## Do not generate

- Repositories, ORM entities, migrations, or a persistence abstraction. Data access is the raw
  `mongodb` driver behind `*-collection.provider.ts` tokens. Index changes belong in the existing
  `ensure-*-indexes.ts` files, which run from bootstrap initializers — there is no migration system.
- A global `ValidationPipe`, `class-validator` DTOs, or `nestjs-pino`. Validation is Zod; logging is
  the shared pino wrapper.
- New top-level documentation files. The set is `README.md`, `AGENTS.md`, `CLAUDE.md`, and one
  README per service.
- Queue, exchange or routing-key declarations. Topology comes from `deriveQueueTopology` and the
  `MessagingModule`.

## Tests are part of the change

Unit tests are colocated and the suites enforce 90% line and branch coverage. New logic should be a
pure exported function with its own `*.spec.ts` next to it, not an untested method on a service.
Do not move a Testcontainers test into the unit suite to make it run in `pnpm test`.

## After modifying

```bash
pnpm --filter <package> run lint
pnpm --filter <package> run test
```

and `pnpm check` before finishing. ESLint runs with `--fix` and enforces strict rules that will
rewrite or reject generated code: `I`-prefixed interfaces, `strict-boolean-expressions`, inline type
imports, no floating promises, and `eslint-plugin-security` — an inevitable dynamic `fs` call needs a
targeted `eslint-disable-next-line` with a real justification, matching the existing ones.

## Environment notes

`pnpm build` must have run before any service starts, because `@task1/shared` is consumed through
its `dist/` exports. Integration tests (`pnpm test:int`) require a running Docker daemon and pull
`rabbitmq:3-management-alpine`, `mongo:7` and `redis/redis-stack-server` — do not assume they are
available in a sandbox; if they cannot run, say so rather than reporting the suite as passing.

## Library documentation

Use Context7 for dependency APIs — see the "Library documentation" section of
[AGENTS.md](AGENTS.md).
