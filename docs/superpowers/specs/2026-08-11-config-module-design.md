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

- `main.ts` (all three services): after the Nest application/microservice instance is
  created, read config via `app.get(rabbitmqConfig.KEY)` (and `appConfig.KEY` for the
  gateway's port) instead of `process.env`.
- gateway `health.module.ts`: `ClientsModule.registerAsync` uses
  `inject: [rabbitmqConfig.KEY]` with a typed factory instead of reading `process.env`
  inside `useFactory`.

## Lint fix

`eslint-plugin-unicorn`'s `prevent-abbreviations` rule flags the word "config" (wants
"configuration") by default, which would fire on `ConfigService`, `rabbitmqConfig`, etc. —
the same category of noise the project's `allowList` already carves out exceptions for
(`Dto`, `E2e`, ...). Fix: add `config: true, Config: true` to the `unicorn/prevent-abbreviations`
`allowList` in all three (currently identical) `eslint.config.mjs` files.

No identifier will be named `env`, so no equivalent exception is needed for that word.

## Out of scope

- No `.env` files are created or committed; `.env.example` files are left as documentation.
- No changes to `docker-compose.yml` — it already injects the same env var names.
- No new AWS services, caching, or persistence layer.
