# Zod-validated nested config module per service — Design

## Goal

Replace direct `process.env.X` reads in `gateway`, `users-service`, and `products-service`
with a typed, Zod-validated configuration loaded through NestJS's `ConfigModule`. Nothing
outside the config module may read `process.env` directly.

## Library choice

- `@nestjs/config` (official Nest config module) + `zod` for schema validation.
- Each config namespace is defined with `registerAs(name, factory)`. The factory reads the
  relevant `process.env` keys once and immediately parses them with a Zod schema — this
  produces the nested, validated shape in a single step, so Nest's separate `validate()`
  hook (which only sees flat env vars, not nested config) is not used.
- If a Zod schema fails to parse, the `registerAs` factory throws during module
  initialization, so the application fails to start on invalid/missing configuration
  (fail-closed).

## Config shape

Only namespaces with real env vars behind them are created — no placeholder `db` namespace,
since no persistence layer exists yet.

### gateway (`back-end/gateway/src/config/`)

- `app.config.ts` → namespace `app`:
  - `port: number` ← `PORT`, `z.coerce.number().int().min(1).max(65535)`, default `3000`
- `rabbitmq.config.ts` → namespace `rabbitmq`:
  - `url: string` ← `RABBITMQ_URL`, validated as a URL, default `amqp://guest:guest@localhost:5672`
  - `usersQueue: string` ← `RABBITMQ_USERS_QUEUE`, `min(1)`, default `users_service_queue`
  - `productsQueue: string` ← `RABBITMQ_PRODUCTS_QUEUE`, `min(1)`, default `products_service_queue`

### users-service (`back-end/users-service/src/config/`)

- `rabbitmq.config.ts` → namespace `rabbitmq`:
  - `url: string` ← `RABBITMQ_URL`, same rule/default as above
  - `queue: string` ← `RABBITMQ_QUEUE`, `min(1)`, default `users_service_queue`

### products-service (`back-end/products-service/src/config/`)

- `rabbitmq.config.ts` → namespace `rabbitmq`:
  - `url: string` ← `RABBITMQ_URL`, same rule/default as above
  - `queue: string` ← `RABBITMQ_QUEUE`, `min(1)`, default `products_service_queue`

Defaults mirror the current `process.env.X ?? '...'` fallbacks already in the codebase, so
local dev without a `.env` file keeps working unchanged.

## Module wiring

Each service's `AppModule` imports `ConfigModule.forRoot({ isGlobal: true, load: [...namespaces] })`
directly from `@nestjs/config` — no extra wrapper module is introduced, per the project's
"no unnecessary abstractions" rule.

## Consumers

- `main.ts` (all three services): calls the `registerAs`-wrapped config factory (e.g.
  `rabbitmqConfig()`, and `appConfig()` for the gateway's port) directly as a plain
  function — not via `app.get()`/DI — instead of reading `process.env`. This is required
  because the config values are needed before any Nest application/microservice instance
  exists (for `products-service`/`users-service`, the transport options are constructor
  arguments to `NestFactory.createMicroservice`, so no DI container is available yet).
  `registerAs(name, factory)` returns the factory itself as a plain callable function
  (tagged with a `.KEY` property used for DI elsewhere), so it can be invoked directly
  with no Nest container involved.
- gateway `health.module.ts`: `ClientsModule.registerAsync` uses
  `inject: [rabbitmqConfig.KEY]` with a typed factory instead of reading `process.env`
  inside `useFactory`.

## Lint fix

Verified empirically (installed the exact toolchain versions from each service's
`package.json` in an isolated sandbox and ran `eslint` against the real planned file
contents) before assuming anything:

- `eslint-plugin-unicorn`'s `prevent-abbreviations` rule does **not** flag "config" —
  in its abbreviation table `config` is a suggested *replacement* for the abbreviation
  `conf`, not an abbreviation itself. No `allowList`/`eslint.config.mjs` change is needed
  for `ConfigModule`, `ConfigType`, `registerAs`, `appConfig`, `rabbitmqConfig`, etc.
- The one real lint finding: writing `registerAs('app', (): AppConfiguration => schema.parse({...}))`
  as a single call with the arrow function inline doesn't match this project's Prettier
  config (`printWidth: 100`) — Prettier reformats it to put the factory arrow function as
  its own argument on a new line. The task steps below show the file contents in that
  already-`--fix`ed, lint-clean form, so no separate "fix lint" step is needed at
  implementation time — `pnpm lint` should pass on the first run.

No identifier will be named `env`, so no `unicorn/prevent-abbreviations` exception is
needed for that word either (bare `process.env` member access isn't a declared
identifier and isn't checked by that rule).

## Out of scope

- No `.env` files are created or committed; `.env.example` files are left as documentation.
- No changes to `docker-compose.yml` — it already injects the same env var names.
- No new AWS services, caching, or persistence layer.
