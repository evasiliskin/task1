# Zod-validated nested config module per service — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every direct `process.env.X` read in `gateway`, `users-service`, and `products-service` with a typed, Zod-validated nested configuration loaded through NestJS's `ConfigModule`.

**Architecture:** Each service gets a `src/config/` folder with one file per namespace. Each file defines a Zod schema and wraps it in `@nestjs/config`'s `registerAs(namespace, factory)`, where the factory reads the relevant `process.env` keys and immediately parses them with the schema. The factory is directly callable as a plain function (used in `main.ts`, before Nest's DI container exists) and is also injectable via its `.KEY` token (used inside modules, e.g. `ClientsModule.registerAsync`). `AppModule` registers all namespaces once via `ConfigModule.forRoot({ isGlobal: true, load: [...] })`.

**Tech Stack:** NestJS 11, `@nestjs/config` 4.0.4, `zod` 4.4.3, Vitest (existing).

## Global Constraints

- Do not read `process.env` anywhere outside a `src/config/*.config.ts` file. Everything else (main.ts, modules, controllers) must go through the config module.
- Config shape is nested by namespace (`app`, `rabbitmq`) — no flat top-level env-var-shaped objects.
- Invalid or missing-but-required config must throw during bootstrap (fail closed). Every field that has a safe, currently-hardcoded fallback keeps that fallback as a Zod `.default(...)` so local dev without a `.env` file keeps working unchanged.
- No new namespaces beyond what real env vars already exist for (no empty `db` placeholder — see spec).
- Match the project's existing code style exactly: single quotes, 2-space indent, trailing commas, `printWidth: 100` (project Prettier config) — the file contents below are already in `eslint --fix`-clean form (verified against the exact installed toolchain versions in an isolated sandbox before writing this plan).
- Spec: `docs/superpowers/specs/2026-08-11-config-module-design.md`.

---

### Task 1: gateway — config schemas (`app`, `rabbitmq`) + unit tests

**Files:**
- Modify: `back-end/gateway/package.json`
- Create: `back-end/gateway/src/config/app.config.ts`
- Create: `back-end/gateway/src/config/app.config.spec.ts`
- Create: `back-end/gateway/src/config/rabbitmq.config.ts`
- Create: `back-end/gateway/src/config/rabbitmq.config.spec.ts`

**Interfaces:**
- Produces: `export default` from `app.config.ts` — a callable `() => { port: number }`, also usable as a DI token via its `.KEY` property (Nest's `registerAs` convention). Type `AppConfiguration = { port: number }`.
- Produces: `export default` from `rabbitmq.config.ts` — a callable `() => { url: string; usersQueue: string; productsQueue: string }`, `.KEY` DI token. Type `RabbitmqConfiguration = { url: string; usersQueue: string; productsQueue: string }`.
- Consumed by: Task 2 (`app.module.ts`, `main.ts`, `health.module.ts`).

- [ ] **Step 1: Add `@nestjs/config` and `zod` as dependencies**

Run from the repo root:

```bash
pnpm --filter gateway add @nestjs/config@^4.0.4 zod@^4.4.3
```

Expected: `back-end/gateway/package.json` gains two new entries in `dependencies` (alphabetically: `@nestjs/config` right after `@nestjs/common`, `zod` at the end after `rxjs`), and the root `pnpm-lock.yaml` is updated. No errors.

- [ ] **Step 2: Write the failing tests for `app.config.ts`**

Create `back-end/gateway/src/config/app.config.spec.ts`:

```typescript
import appConfig from './app.config';

describe('appConfig', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('defaults port to 3000 when PORT is not set', () => {
    delete process.env.PORT;

    expect(appConfig()).toEqual({ port: 3000 });
  });

  it('coerces PORT from a string to a number', () => {
    process.env.PORT = '8080';

    expect(appConfig()).toEqual({ port: 8080 });
  });

  it('throws when PORT is out of range', () => {
    process.env.PORT = '70000';

    expect(() => appConfig()).toThrow();
  });

  it('throws when PORT is not numeric', () => {
    process.env.PORT = 'not-a-number';

    expect(() => appConfig()).toThrow();
  });
});
```

- [ ] **Step 2b: Run it to verify it fails (module doesn't exist yet)**

Run: `pnpm --filter gateway exec vitest run src/config/app.config.spec.ts`
Expected: FAIL — `Cannot find module './app.config'` (or similar resolution error).

- [ ] **Step 3: Implement `app.config.ts`**

Create `back-end/gateway/src/config/app.config.ts`:

```typescript
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const appConfigSchema = z.object({
  port: z.coerce.number().int().min(1).max(65535).default(3000),
});

export type AppConfiguration = z.infer<typeof appConfigSchema>;

export default registerAs(
  'app',
  (): AppConfiguration =>
    appConfigSchema.parse({
      port: process.env.PORT,
    }),
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter gateway exec vitest run src/config/app.config.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing tests for `rabbitmq.config.ts`**

Create `back-end/gateway/src/config/rabbitmq.config.spec.ts`:

```typescript
import rabbitmqConfig from './rabbitmq.config';

describe('rabbitmqConfig', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns the documented defaults when no env vars are set', () => {
    delete process.env.RABBITMQ_URL;
    delete process.env.RABBITMQ_USERS_QUEUE;
    delete process.env.RABBITMQ_PRODUCTS_QUEUE;

    expect(rabbitmqConfig()).toEqual({
      url: 'amqp://guest:guest@localhost:5672',
      usersQueue: 'users_service_queue',
      productsQueue: 'products_service_queue',
    });
  });

  it('parses values from environment variables', () => {
    process.env.RABBITMQ_URL = 'amqp://user:pass@rabbit-host:5672';
    process.env.RABBITMQ_USERS_QUEUE = 'custom_users_queue';
    process.env.RABBITMQ_PRODUCTS_QUEUE = 'custom_products_queue';

    expect(rabbitmqConfig()).toEqual({
      url: 'amqp://user:pass@rabbit-host:5672',
      usersQueue: 'custom_users_queue',
      productsQueue: 'custom_products_queue',
    });
  });

  it('throws when RABBITMQ_URL is not a valid url', () => {
    process.env.RABBITMQ_URL = 'not-a-valid-url';

    expect(() => rabbitmqConfig()).toThrow();
  });

  it('throws when RABBITMQ_USERS_QUEUE is an empty string', () => {
    process.env.RABBITMQ_USERS_QUEUE = '';

    expect(() => rabbitmqConfig()).toThrow();
  });
});
```

- [ ] **Step 5b: Run it to verify it fails**

Run: `pnpm --filter gateway exec vitest run src/config/rabbitmq.config.spec.ts`
Expected: FAIL — `Cannot find module './rabbitmq.config'`.

- [ ] **Step 6: Implement `rabbitmq.config.ts`**

Create `back-end/gateway/src/config/rabbitmq.config.ts`:

```typescript
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const rabbitmqConfigSchema = z.object({
  url: z.url().default('amqp://guest:guest@localhost:5672'),
  usersQueue: z.string().min(1).default('users_service_queue'),
  productsQueue: z.string().min(1).default('products_service_queue'),
});

export type RabbitmqConfiguration = z.infer<typeof rabbitmqConfigSchema>;

export default registerAs(
  'rabbitmq',
  (): RabbitmqConfiguration =>
    rabbitmqConfigSchema.parse({
      url: process.env.RABBITMQ_URL,
      usersQueue: process.env.RABBITMQ_USERS_QUEUE,
      productsQueue: process.env.RABBITMQ_PRODUCTS_QUEUE,
    }),
);
```

- [ ] **Step 7: Run both spec files and the linter**

Run: `pnpm --filter gateway exec vitest run src/config/app.config.spec.ts src/config/rabbitmq.config.spec.ts`
Expected: PASS (8 tests total).

Run: `pnpm --filter gateway run lint`
Expected: exits 0, no errors (the file contents above are already in the Prettier-fixed form).

- [ ] **Step 8: Commit**

Leave the changes staged/unstaged — per project convention (`CLAUDE.md` → Git section), commits are created by the user manually, not automatically.

---

### Task 2: gateway — wire `main.ts`, `app.module.ts`, `health.module.ts` to the config module

**Files:**
- Modify: `back-end/gateway/src/app.module.ts`
- Modify: `back-end/gateway/src/main.ts`
- Modify: `back-end/gateway/src/health/health.module.ts`

**Interfaces:**
- Consumes: `appConfig` default export + `.KEY` from Task 1's `src/config/app.config.ts` (`() => { port: number }`).
- Consumes: `rabbitmqConfig` default export + `.KEY` from Task 1's `src/config/rabbitmq.config.ts` (`() => { url: string; usersQueue: string; productsQueue: string }`).

- [ ] **Step 1: Update `app.module.ts` to register the config module**

Modify `back-end/gateway/src/app.module.ts`. Current content:

```typescript
import { Module } from '@nestjs/common';

import { ExceptionHandlingModule } from './core/exception-handling/exception-handling.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [ExceptionHandlingModule, HealthModule],
})
export class AppModule {}
```

Replace with:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import appConfig from './config/app.config';
import rabbitmqConfig from './config/rabbitmq.config';
import { ExceptionHandlingModule } from './core/exception-handling/exception-handling.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [appConfig, rabbitmqConfig] }),
    ExceptionHandlingModule,
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Update `main.ts` to read the port from config instead of `process.env`**

Modify `back-end/gateway/src/main.ts`. Current content:

```typescript
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
```

Replace with:

```typescript
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import appConfig from './config/app.config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const { port } = appConfig();
  await app.listen(port);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 3: Update `health.module.ts` to inject rabbitmq config instead of reading `process.env`**

Modify `back-end/gateway/src/health/health.module.ts`. Current content:

```typescript
import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller';
import { PRODUCTS_SERVICE_RMQ_CLIENT, USERS_SERVICE_RMQ_CLIENT } from './rabbitmq-clients.tokens';
import { RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator';

@Module({
  imports: [
    TerminusModule,
    ClientsModule.registerAsync([
      {
        name: USERS_SERVICE_RMQ_CLIENT,
        useFactory: () => ({
          transport: Transport.RMQ,
          options: {
            urls: [process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672'],
            queue: process.env.RABBITMQ_USERS_QUEUE ?? 'users_service_queue',
            queueOptions: { durable: true },
          },
        }),
      },
      {
        name: PRODUCTS_SERVICE_RMQ_CLIENT,
        useFactory: () => ({
          transport: Transport.RMQ,
          options: {
            urls: [process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672'],
            queue: process.env.RABBITMQ_PRODUCTS_QUEUE ?? 'products_service_queue',
            queueOptions: { durable: true },
          },
        }),
      },
    ]),
  ],
  controllers: [HealthController],
  providers: [RabbitMqPingHealthIndicator],
})
export class HealthModule {}
```

Replace with:

```typescript
import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { TerminusModule } from '@nestjs/terminus';

import rabbitmqConfig from '../config/rabbitmq.config';

import { HealthController } from './health.controller';
import { PRODUCTS_SERVICE_RMQ_CLIENT, USERS_SERVICE_RMQ_CLIENT } from './rabbitmq-clients.tokens';
import { RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator';

@Module({
  imports: [
    TerminusModule,
    ClientsModule.registerAsync([
      {
        name: USERS_SERVICE_RMQ_CLIENT,
        inject: [rabbitmqConfig.KEY],
        useFactory: (config: ConfigType<typeof rabbitmqConfig>) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.url],
            queue: config.usersQueue,
            queueOptions: { durable: true },
          },
        }),
      },
      {
        name: PRODUCTS_SERVICE_RMQ_CLIENT,
        inject: [rabbitmqConfig.KEY],
        useFactory: (config: ConfigType<typeof rabbitmqConfig>) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.url],
            queue: config.productsQueue,
            queueOptions: { durable: true },
          },
        }),
      },
    ]),
  ],
  controllers: [HealthController],
  providers: [RabbitMqPingHealthIndicator],
})
export class HealthModule {}
```

Note: `back-end/gateway/src/health/health.controller.int.spec.ts` imports `HealthModule` directly and overrides both `USERS_SERVICE_RMQ_CLIENT` and `PRODUCTS_SERVICE_RMQ_CLIENT` with `overrideProvider(...).useValue(...)`. This fully replaces those providers' definitions (including their new `inject: [rabbitmqConfig.KEY]`) before the module compiles, so `rabbitmqConfig.KEY` never needs to be resolved in that test — it keeps passing unmodified. (Verified directly: a throwaway reproduction of this exact pattern — a provider from a nested `registerAsync`-style dynamic module with an unresolved `inject` dependency, fully overridden via `overrideProvider().useValue()` — compiled and passed cleanly.)

- [ ] **Step 4: Run the full gateway test suite**

Run: `pnpm --filter gateway run test`
Expected: PASS, all existing tests (including `health.controller.int.spec.ts` and `rabbitmq-ping.health-indicator.spec.ts`) plus Task 1's new config tests are green.

- [ ] **Step 5: Run the linter**

Run: `pnpm --filter gateway run lint`
Expected: exits 0, no errors.

- [ ] **Step 6: Run a full build**

Run: `pnpm --filter gateway run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 7: Commit**

Leave the changes staged/unstaged for the user to commit manually.

---

### Task 3: products-service — config schema + unit tests

**Files:**
- Modify: `back-end/products-service/package.json`
- Create: `back-end/products-service/src/config/rabbitmq.config.ts`
- Create: `back-end/products-service/src/config/rabbitmq.config.spec.ts`

**Interfaces:**
- Produces: `export default` from `rabbitmq.config.ts` — a callable `() => { url: string; queue: string }`, `.KEY` DI token. Type `RabbitmqConfiguration = { url: string; queue: string }`.
- Consumed by: Task 4 (`app.module.ts`, `main.ts`).

- [ ] **Step 1: Add `@nestjs/config` and `zod` as dependencies**

Run from the repo root:

```bash
pnpm --filter products-service add @nestjs/config@^4.0.4 zod@^4.4.3
```

Expected: `back-end/products-service/package.json` gains the two new `dependencies` entries (alphabetically placed), `pnpm-lock.yaml` updated, no errors.

- [ ] **Step 2: Write the failing tests**

Create `back-end/products-service/src/config/rabbitmq.config.spec.ts`:

```typescript
import rabbitmqConfig from './rabbitmq.config';

describe('rabbitmqConfig', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns the documented defaults when no env vars are set', () => {
    delete process.env.RABBITMQ_URL;
    delete process.env.RABBITMQ_QUEUE;

    expect(rabbitmqConfig()).toEqual({
      url: 'amqp://guest:guest@localhost:5672',
      queue: 'products_service_queue',
    });
  });

  it('parses values from environment variables', () => {
    process.env.RABBITMQ_URL = 'amqp://user:pass@rabbit-host:5672';
    process.env.RABBITMQ_QUEUE = 'custom_queue';

    expect(rabbitmqConfig()).toEqual({
      url: 'amqp://user:pass@rabbit-host:5672',
      queue: 'custom_queue',
    });
  });

  it('throws when RABBITMQ_URL is not a valid url', () => {
    process.env.RABBITMQ_URL = 'not-a-valid-url';

    expect(() => rabbitmqConfig()).toThrow();
  });

  it('throws when RABBITMQ_QUEUE is an empty string', () => {
    process.env.RABBITMQ_QUEUE = '';

    expect(() => rabbitmqConfig()).toThrow();
  });
});
```

- [ ] **Step 2b: Run it to verify it fails**

Run: `pnpm --filter products-service exec vitest run src/config/rabbitmq.config.spec.ts`
Expected: FAIL — `Cannot find module './rabbitmq.config'`.

- [ ] **Step 3: Implement `rabbitmq.config.ts`**

Create `back-end/products-service/src/config/rabbitmq.config.ts`:

```typescript
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const rabbitmqConfigSchema = z.object({
  url: z.url().default('amqp://guest:guest@localhost:5672'),
  queue: z.string().min(1).default('products_service_queue'),
});

export type RabbitmqConfiguration = z.infer<typeof rabbitmqConfigSchema>;

export default registerAs(
  'rabbitmq',
  (): RabbitmqConfiguration =>
    rabbitmqConfigSchema.parse({
      url: process.env.RABBITMQ_URL,
      queue: process.env.RABBITMQ_QUEUE,
    }),
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter products-service exec vitest run src/config/rabbitmq.config.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the linter**

Run: `pnpm --filter products-service run lint`
Expected: exits 0, no errors.

- [ ] **Step 6: Commit**

Leave the changes staged/unstaged for the user to commit manually.

---

### Task 4: products-service — wire `main.ts` and `app.module.ts` to the config module

**Files:**
- Modify: `back-end/products-service/src/app.module.ts`
- Modify: `back-end/products-service/src/main.ts`

**Interfaces:**
- Consumes: `rabbitmqConfig` default export from Task 3's `src/config/rabbitmq.config.ts` (`() => { url: string; queue: string }`).

- [ ] **Step 1: Update `app.module.ts`**

Modify `back-end/products-service/src/app.module.ts`. Current content:

```typescript
import { Module } from '@nestjs/common';

import { ExceptionHandlingModule } from './core/exception-handling/exception-handling.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [ExceptionHandlingModule, HealthModule],
})
export class AppModule {}
```

Replace with:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import rabbitmqConfig from './config/rabbitmq.config';
import { ExceptionHandlingModule } from './core/exception-handling/exception-handling.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [rabbitmqConfig] }),
    ExceptionHandlingModule,
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Update `main.ts`**

Modify `back-end/products-service/src/main.ts`. Current content:

```typescript
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672'],
      queue: process.env.RABBITMQ_QUEUE ?? 'products_service_queue',
      queueOptions: { durable: true },
    },
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen();
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
```

Replace with:

```typescript
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';

import { AppModule } from './app.module';
import rabbitmqConfig from './config/rabbitmq.config';

async function bootstrap(): Promise<void> {
  const { url, queue } = rabbitmqConfig();

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.RMQ,
    options: {
      urls: [url],
      queue,
      queueOptions: { durable: true },
    },
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen();
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 3: Run the full products-service test suite**

Run: `pnpm --filter products-service run test`
Expected: PASS, all existing tests plus Task 3's new config tests are green.

- [ ] **Step 4: Run the linter**

Run: `pnpm --filter products-service run lint`
Expected: exits 0, no errors.

- [ ] **Step 5: Run a full build**

Run: `pnpm --filter products-service run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 6: Commit**

Leave the changes staged/unstaged for the user to commit manually.

---

### Task 5: users-service — config schema + unit tests

**Files:**
- Modify: `back-end/users-service/package.json`
- Create: `back-end/users-service/src/config/rabbitmq.config.ts`
- Create: `back-end/users-service/src/config/rabbitmq.config.spec.ts`

**Interfaces:**
- Produces: `export default` from `rabbitmq.config.ts` — a callable `() => { url: string; queue: string }`, `.KEY` DI token. Type `RabbitmqConfiguration = { url: string; queue: string }`.
- Consumed by: Task 6 (`app.module.ts`, `main.ts`).

- [ ] **Step 1: Add `@nestjs/config` and `zod` as dependencies**

Run from the repo root:

```bash
pnpm --filter users-service add @nestjs/config@^4.0.4 zod@^4.4.3
```

Expected: `back-end/users-service/package.json` gains the two new `dependencies` entries (alphabetically placed), `pnpm-lock.yaml` updated, no errors.

- [ ] **Step 2: Write the failing tests**

Create `back-end/users-service/src/config/rabbitmq.config.spec.ts`:

```typescript
import rabbitmqConfig from './rabbitmq.config';

describe('rabbitmqConfig', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns the documented defaults when no env vars are set', () => {
    delete process.env.RABBITMQ_URL;
    delete process.env.RABBITMQ_QUEUE;

    expect(rabbitmqConfig()).toEqual({
      url: 'amqp://guest:guest@localhost:5672',
      queue: 'users_service_queue',
    });
  });

  it('parses values from environment variables', () => {
    process.env.RABBITMQ_URL = 'amqp://user:pass@rabbit-host:5672';
    process.env.RABBITMQ_QUEUE = 'custom_queue';

    expect(rabbitmqConfig()).toEqual({
      url: 'amqp://user:pass@rabbit-host:5672',
      queue: 'custom_queue',
    });
  });

  it('throws when RABBITMQ_URL is not a valid url', () => {
    process.env.RABBITMQ_URL = 'not-a-valid-url';

    expect(() => rabbitmqConfig()).toThrow();
  });

  it('throws when RABBITMQ_QUEUE is an empty string', () => {
    process.env.RABBITMQ_QUEUE = '';

    expect(() => rabbitmqConfig()).toThrow();
  });
});
```

- [ ] **Step 2b: Run it to verify it fails**

Run: `pnpm --filter users-service exec vitest run src/config/rabbitmq.config.spec.ts`
Expected: FAIL — `Cannot find module './rabbitmq.config'`.

- [ ] **Step 3: Implement `rabbitmq.config.ts`**

Create `back-end/users-service/src/config/rabbitmq.config.ts`:

```typescript
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const rabbitmqConfigSchema = z.object({
  url: z.url().default('amqp://guest:guest@localhost:5672'),
  queue: z.string().min(1).default('users_service_queue'),
});

export type RabbitmqConfiguration = z.infer<typeof rabbitmqConfigSchema>;

export default registerAs(
  'rabbitmq',
  (): RabbitmqConfiguration =>
    rabbitmqConfigSchema.parse({
      url: process.env.RABBITMQ_URL,
      queue: process.env.RABBITMQ_QUEUE,
    }),
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter users-service exec vitest run src/config/rabbitmq.config.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the linter**

Run: `pnpm --filter users-service run lint`
Expected: exits 0, no errors.

- [ ] **Step 6: Commit**

Leave the changes staged/unstaged for the user to commit manually.

---

### Task 6: users-service — wire `main.ts` and `app.module.ts` to the config module

**Files:**
- Modify: `back-end/users-service/src/app.module.ts`
- Modify: `back-end/users-service/src/main.ts`

**Interfaces:**
- Consumes: `rabbitmqConfig` default export from Task 5's `src/config/rabbitmq.config.ts` (`() => { url: string; queue: string }`).

- [ ] **Step 1: Update `app.module.ts`**

Modify `back-end/users-service/src/app.module.ts`. Current content:

```typescript
import { Module } from '@nestjs/common';

import { ExceptionHandlingModule } from './core/exception-handling/exception-handling.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [ExceptionHandlingModule, HealthModule],
})
export class AppModule {}
```

Replace with:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import rabbitmqConfig from './config/rabbitmq.config';
import { ExceptionHandlingModule } from './core/exception-handling/exception-handling.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [rabbitmqConfig] }),
    ExceptionHandlingModule,
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Update `main.ts`**

Modify `back-end/users-service/src/main.ts`. Current content:

```typescript
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672'],
      queue: process.env.RABBITMQ_QUEUE ?? 'users_service_queue',
      queueOptions: { durable: true },
    },
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen();
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
```

Replace with:

```typescript
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';

import { AppModule } from './app.module';
import rabbitmqConfig from './config/rabbitmq.config';

async function bootstrap(): Promise<void> {
  const { url, queue } = rabbitmqConfig();

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.RMQ,
    options: {
      urls: [url],
      queue,
      queueOptions: { durable: true },
    },
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen();
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 3: Run the full users-service test suite**

Run: `pnpm --filter users-service run test`
Expected: PASS, all existing tests plus Task 5's new config tests are green.

- [ ] **Step 4: Run the linter**

Run: `pnpm --filter users-service run lint`
Expected: exits 0, no errors.

- [ ] **Step 5: Run a full build**

Run: `pnpm --filter users-service run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 6: Commit**

Leave the changes staged/unstaged for the user to commit manually.

---

### Task 7: Workspace-wide verification

**Files:** none (verification only).

**Interfaces:** none — this task only runs commands across all three services.

- [ ] **Step 1: Confirm no `process.env` reads remain outside `src/config/*.config.ts`**

Run from the repo root:

```bash
grep -rn "process.env" back-end/gateway/src back-end/products-service/src back-end/users-service/src --include="*.ts"
```

Expected: every matching line is inside a `src/config/*.config.ts` file. No matches in `main.ts`, `app.module.ts`, `health.module.ts`, or elsewhere.

- [ ] **Step 2: Run the full workspace lint**

Run: `pnpm lint`
Expected: exits 0 across all three services (and front-end, unaffected by this change).

- [ ] **Step 3: Run the full workspace test suite**

Run: `pnpm test`
Expected: exits 0 across all three services.

- [ ] **Step 4: Run the full workspace build**

Run: `pnpm build`
Expected: exits 0 across all three services (and front-end).

- [ ] **Step 5: Commit**

Leave the changes staged/unstaged for the user to commit manually.
