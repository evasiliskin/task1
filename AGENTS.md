# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Copilot, etc.) working in this
repository. Human contributors should read [README.txt](README.txt) instead.

## Project overview

`task1` is a pnpm workspace monorepo containing a NestJS microservices backend that ingests
[GH Archive](https://www.gharchive.org/) data and exposes it over a REST API:

| Package | Role |
| --- | --- |
| `back-end/api-gateway` | Public HTTP entrypoint — REST API (Swagger at `/api-docs`), the only service exposed to clients |
| `back-end/service-a` | Internal microservice, RabbitMQ transport only — GH Archive ingestion (download/upload, parse, persist events, track import runs) |
| `back-end/service-b` | Internal microservice, RabbitMQ transport only — processing-log tracking, stats, PDF report generation |
| `back-end/libs/shared` (`@task1/shared`) | Shared library: error types, exception handling, request-context/correlation-ID propagation, logging, GH Archive event contracts, security config |

The gateway talks to `service-a`/`service-b` exclusively over RabbitMQ RPC (`ClientProxy.send`) and
fire-and-forget events (`ClientProxy.emit` / `@EventPattern`) — never HTTP, never direct database
access. See [README.txt](README.txt)'s "Architecture" section for the request-flow diagram, the
full API reference, and the GH Archive pipeline design.

## Setup

```bash
nvm use          # Node version pinned in .nvmrc, matches engines.node in package.json
pnpm install      # also installs Husky git hooks, via the root "prepare" script
```

Per-service env files: copy `back-end/<service>/.env.example` to `.env` before running a service
outside Docker (`pnpm docker:up` supplies its own environment and needs no `.env` files). Note that
`ConfigModule.forRoot({ ignoreEnvFile: true })` in every `app.module.ts` means `.env` is a
reference/template only, never auto-loaded — to override a default, export the variable into the
shell environment (or use `dotenv-cli`) before running `pnpm dev:*`.

## Build, lint, test

Run from the repo root — pnpm workspace filters apply automatically:

| Command | What it does |
| --- | --- |
| `pnpm build` | Build every workspace package |
| `pnpm test` | Run every package's tests (Vitest) |
| `pnpm lint` | ESLint across all three back-end services |
| `pnpm format` / `pnpm format:check` | Prettier across the whole workspace |
| `pnpm check` | `lint` + `test` — also runs automatically on `git push` via Husky (`.husky/pre-push`) |
| `pnpm dev:api-gateway` / `dev:service-a` / `dev:service-b` | Run one service in watch mode |
| `pnpm docker:up` / `pnpm docker:down` | Start/stop RabbitMQ + MongoDB + Redis + all three services |

Run a single package's suite directly with `pnpm --filter <package> run <script>`, e.g.
`pnpm --filter api-gateway run test:cov`.

**Before considering any change done: run `pnpm lint` and `pnpm test` (or `pnpm check`) for every
package you touched.**

## Testing conventions

- Unit tests: `*.spec.ts`, colocated with the source file.
- HTTP integration tests: `*.controller.int.spec.ts`, using Supertest — required for every
  controller with an HTTP endpoint (currently all 8 `api-gateway` controllers).
- RabbitMQ-only controllers (`@MessagePattern`/`@EventPattern`, no HTTP) are covered by
  `*.spec.ts` instead — call the handler directly through `Test.createTestingModule()`, no
  Supertest. `service-a` and `service-b` have no HTTP layer, so every one of their tests is a
  unit spec.
- Coverage: each package's `vitest.config.mts` enforces a 90% line/branch threshold
  (`coverage.thresholds`) — a package with insufficient coverage fails `pnpm test`.
- Full conventions (naming `should <behavior>, when <condition>`, AAA structure, coverage
  targets, fixture/UUID rules): [skills/testing-development.md](skills/testing-development.md).

## Code style & architecture rules

This repo enforces a specific layering (controller → service → domain/infrastructure), module
boundaries, an `AppError`-based error hierarchy, and a security-first posture. **Read
[CLAUDE.md](CLAUDE.md) before making non-trivial changes** — it is the source of truth for layer
responsibilities, module boundaries, security defaults, error handling, and what's forbidden
without explicit approval.

Deeper topic-specific rules live in `skills/*.md` (`api.md`, `backend-development.md`,
`security.md`, `testing-development.md`) and are referenced from CLAUDE.md.

**Note on `skills/backend-development.md`:** it was written against a Sequelize/PostgreSQL/AWS
stack and includes examples (a `filing-cabinet` module, Sequelize repositories) that don't exist in
this repo — this project actually uses MongoDB, Redis, and RabbitMQ, with no ORM or Repository
layer. Apply that file's *principles* (SOLID, layer separation, reuse-before-create,
lodash-over-hand-rolled-loops) and defer to the actual code under `back-end/*/src` over its
stack-specific examples.

## Current implementation state — read before assuming an endpoint "just works"

- **Authentication is a stub.** `AuthGuard`
  (`back-end/api-gateway/src/auth/auth.guard.ts`) is registered globally, but its
  `isAuthenticated()` unconditionally returns `true` — every endpoint currently responds normally
  with no credentials supplied. This is a deliberate placeholder: the seam (`canActivate`, the
  `@Public()` override, `isAuthenticated`) exists so a real provider (Auth0, Passport.js, JWT/OIDC)
  can be dropped in behind it. Do not replace the stub with real auth unless explicitly asked.
  Integration tests still override the guard
  (`.overrideProvider(AuthGuard).useValue({ canActivate: () => true })`) so they don't depend on
  the stub's current behavior — follow that pattern in new integration tests.
- **No general persistence layer.** The only MongoDB usage is the GH Archive pipeline's own
  collections (`events`, `imports` in service-a; `processing-logs` in service-b), accessed directly
  via the `mongodb` driver — no ORM, no Repository pattern. Don't introduce one without an explicit
  ask (see CLAUDE.md's forbidden-without-approval list).
- Full endpoint list and RabbitMQ message-pattern names: see [README.txt](README.txt)'s
  "API reference" section.

## Commits

**Never create git commits.** The user commits their own work manually — leave changes
staged/unstaged, even mid-workflow (e.g. a planning/spec-writing step that would normally commit
as part of its own process).

## Documentation lookups

Use Context7 (or whichever MCP/CLI documentation tool is available) for NestJS, Vitest, or any
other library/framework/API question instead of relying on training data — this stack tracks
current major versions (NestJS 11, Vitest 4, Zod 4, MongoDB driver 7) where remembered APIs are
likely stale. Never guess an API when documentation is available.
