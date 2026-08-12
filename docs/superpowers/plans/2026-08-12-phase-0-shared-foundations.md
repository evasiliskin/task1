# Phase 0: Shared Foundations & Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put in place everything the GitHub Archive platform's later phases (1–10) need before any business logic is written: shared RabbitMQ event contracts in `@task1/shared`, MongoDB/Redis configuration and client wiring in `service-a` and `service-b`, and the docker-compose infrastructure changes (RedisTimeSeries-capable image, shared archive-storage volume, new env vars) required to run any of it.

**Architecture:** `@task1/shared` gains a `github-archive/` subfolder (event DTOs + the whitelisted event-document contract), following the existing convention where cross-cutting/shared concerns live in that workspace package. `service-a` and `service-b` each gain their own `config/mongodb.config.ts` + `config/redis.config.ts` (Zod-validated, `registerAs` pattern — identical shape to `api-gateway`'s existing ones) and their own `infra/mongo/`, `infra/redis/` modules that own a real `MongoClient`/`Redis` connection, connect eagerly at boot (`OnModuleInit`), and close cleanly at shutdown (`OnModuleDestroy`) — this is deliberately more eager than `api-gateway`'s existing lazy health-check-only Mongo/Redis usage, because these two services will issue real business queries starting Phase 2/6, not just pings.

**Tech Stack:** NestJS 11, `@nestjs/config`, Zod (already a dependency in both services), official `mongodb` driver v7, `ioredis` v6 (both already dependencies of `api-gateway`, net-new to `service-a`/`service-b`), Vitest.

**Design doc:** `docs/superpowers/specs/2026-08-12-github-archive-platform-design.md`
**Roadmap:** `docs/superpowers/plans/2026-08-12-github-archive-platform-plan.md` (this is Phase 0 of 11)

## Global Constraints

- Never throw raw `Error` — this phase has no business-error paths (config validation throws Zod's own error uncaught, matching the existing `app.config.ts`/`rabbitmq.config.ts` convention; connection failures at boot propagate uncaught into the existing `bootstrap().catch()` fatal-log-and-exit handler in each service's `main.ts` — no new `AppError` subclass is needed here).
- Every class member has explicit `public`/`private`/`protected` accessibility (`@typescript-eslint/explicit-member-accessibility`).
- Interfaces are `PascalCase` prefixed with `I`; `type` aliases (including every `z.infer<...>` result in this plan) are `PascalCase` with **no** prefix (`@typescript-eslint/naming-convention` — verified against `back-end/service-a/eslint.config.mjs`).
- Type-only imports use inline `type` modifiers (`@typescript-eslint/consistent-type-imports`, `fixStyle: inline-type-imports`).
- Imports grouped (`builtin`, `external`, `internal`, `parent`, `sibling`, `index`), alphabetized ascending case-insensitive, blank line between groups (`import-x/order`).
- `@typescript-eslint/strict-boolean-expressions` is on — no implicit truthiness checks on nullable values.
- Blank line required before every `return`/`throw` following a `const`/`let`/`var` or expression statement, and before every `if` (`padding-line-between-statements`).
- Member ordering: public fields → public constructor → public methods → ... → private fields/methods last (`@typescript-eslint/member-ordering`) — constructor-parameter properties (e.g. `private readonly client: MongoClient` declared directly in the constructor signature) are exempt, matching the existing `MongoHealthIndicator`/`RedisHealthIndicator` pattern in `api-gateway`.
- All relative imports use an explicit `.js` extension (NodeNext module resolution, verified against every existing file in this repo).
- Mocking convention (verified against `mongo.health-indicator.spec.ts`/`redis.health-indicator.spec.ts`): build a plain object literal matching only the members under test, cast with `as unknown as <RealType>` — never `vi.mock()` (ESM hoisting issues per this repo's testing conventions), never `Test.createTestingModule()` when direct construction works.
- BDD test naming: `it('should X, when Y')`.
- No `git commit` in any step — per this project's `CLAUDE.md`, the user commits manually. Every "commit" checkpoint below is written as "stage the files" instead.
- Vitest: `globals: true` (no `describe`/`it`/`vi`/`expect` imports needed), colocated `*.spec.ts`. Coverage thresholds (all packages): 90% lines, 90% branches.
- Config default database names follow the existing `mongodb://localhost:27017/<service-name>` convention already used by `api-gateway` (`.../gateway`) — `service-a` gets `.../service_a`, `service-b` gets `.../service_b`.

---

## Task 1: Shared package — GitHub Archive event & data contracts

**Files:**
- Create: `back-end/libs/shared/src/github-archive/events/event-patterns.const.ts`
- Create: `back-end/libs/shared/src/github-archive/events/import-started.event.ts`
- Create: `back-end/libs/shared/src/github-archive/events/import-started.event.spec.ts`
- Create: `back-end/libs/shared/src/github-archive/events/import-completed.event.ts`
- Create: `back-end/libs/shared/src/github-archive/events/import-completed.event.spec.ts`
- Create: `back-end/libs/shared/src/github-archive/events/import-failed.event.ts`
- Create: `back-end/libs/shared/src/github-archive/events/import-failed.event.spec.ts`
- Create: `back-end/libs/shared/src/github-archive/contracts/github-event.dto.ts`
- Create: `back-end/libs/shared/src/github-archive/index.ts`
- Modify: `back-end/libs/shared/src/index.ts`

**Interfaces:**
- Produces: `EVENT_PATTERNS.IMPORT_STARTED = 'github.import.started'`, `.IMPORT_COMPLETED = 'github.import.completed'`, `.IMPORT_FAILED = 'github.import.failed'`.
- Produces: `importStartedEventSchema`, `ImportStartedEvent` (`{ importId, archive, startedAt, correlationId }`); `importCompletedEventSchema`, `ImportCompletedEvent` (`{ importId, archive, startedAt, completedAt, eventsProcessed, validEvents, invalidEvents, duplicateEvents, errorCount, correlationId }`); `importFailedEventSchema`, `ImportFailedEvent` (`{ importId, archive, startedAt, failedAt, reason, correlationId }`).
- Produces: `IGithubEventDocument { eventId: string; eventType: string; createdAt: Date; actor: IGithubActor; repo: IGithubRepository; org?: IGithubOrganization; importId: string; payload: Record<string, unknown> }`, `IGithubActor { id: number; login: string }`, `IGithubRepository { id: number; name: string }`, `IGithubOrganization { id: number; login: string }`.
- Consumed later by: Phase 2 (`transform-event.ts` produces `IGithubEventDocument`), Phase 4 (search response mapping), Phase 5 (emits the three event types), Phase 6 (validates incoming messages against the three schemas).

- [ ] **Step 1: Write the failing test for `importStartedEventSchema`**

`back-end/libs/shared/src/github-archive/events/import-started.event.spec.ts`:
```ts
import { importStartedEventSchema } from './import-started.event.js';

describe('importStartedEventSchema', () => {
  const validPayload = {
    importId: '11111111-1111-4111-8111-111111111111',
    archive: '2026-08-11-0.json.gz',
    startedAt: '2026-08-11T00:00:00.000Z',
    correlationId: 'c1',
  };

  it('should accept a valid payload, when all fields are present and well-formed', () => {
    expect(importStartedEventSchema.parse(validPayload)).toEqual(validPayload);
  });

  it('should throw, when importId is not a UUID', () => {
    expect(() => importStartedEventSchema.parse({ ...validPayload, importId: 'not-a-uuid' })).toThrow();
  });

  it('should throw, when archive is an empty string', () => {
    expect(() => importStartedEventSchema.parse({ ...validPayload, archive: '' })).toThrow();
  });

  it('should throw, when startedAt is not an ISO datetime string', () => {
    expect(() => importStartedEventSchema.parse({ ...validPayload, startedAt: 'not-a-date' })).toThrow();
  });

  it('should throw, when correlationId is missing', () => {
    const { correlationId, ...withoutCorrelationId } = validPayload;

    expect(() => importStartedEventSchema.parse(withoutCorrelationId)).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @task1/shared test -- import-started.event.spec.ts`
Expected: FAIL — `Cannot find module './import-started.event.js'` (the source file doesn't exist yet).

- [ ] **Step 3: Implement `import-started.event.ts`**

```ts
import { z } from 'zod';

export const importStartedEventSchema = z.object({
  importId: z.uuid(),
  archive: z.string().min(1),
  startedAt: z.iso.datetime(),
  correlationId: z.string().min(1),
});

export type ImportStartedEvent = z.infer<typeof importStartedEventSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @task1/shared test -- import-started.event.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing test for `importCompletedEventSchema`**

`back-end/libs/shared/src/github-archive/events/import-completed.event.spec.ts`:
```ts
import { importCompletedEventSchema } from './import-completed.event.js';

describe('importCompletedEventSchema', () => {
  const validPayload = {
    importId: '11111111-1111-4111-8111-111111111111',
    archive: '2026-08-11-0.json.gz',
    startedAt: '2026-08-11T00:00:00.000Z',
    completedAt: '2026-08-11T00:05:00.000Z',
    eventsProcessed: 1000,
    validEvents: 990,
    invalidEvents: 5,
    duplicateEvents: 5,
    errorCount: 0,
    correlationId: 'c1',
  };

  it('should accept a valid payload, when all fields are present and well-formed', () => {
    expect(importCompletedEventSchema.parse(validPayload)).toEqual(validPayload);
  });

  it('should coerce numeric-string counters, when they arrive as strings over the wire', () => {
    const result = importCompletedEventSchema.parse({ ...validPayload, eventsProcessed: '1000' });

    expect(result.eventsProcessed).toBe(1000);
  });

  it('should throw, when eventsProcessed is negative', () => {
    expect(() =>
      importCompletedEventSchema.parse({ ...validPayload, eventsProcessed: -1 }),
    ).toThrow();
  });

  it('should throw, when completedAt is not an ISO datetime string', () => {
    expect(() =>
      importCompletedEventSchema.parse({ ...validPayload, completedAt: 'not-a-date' }),
    ).toThrow();
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @task1/shared test -- import-completed.event.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `import-completed.event.ts`**

```ts
import { z } from 'zod';

export const importCompletedEventSchema = z.object({
  importId: z.uuid(),
  archive: z.string().min(1),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  eventsProcessed: z.coerce.number().int().nonnegative(),
  validEvents: z.coerce.number().int().nonnegative(),
  invalidEvents: z.coerce.number().int().nonnegative(),
  duplicateEvents: z.coerce.number().int().nonnegative(),
  errorCount: z.coerce.number().int().nonnegative(),
  correlationId: z.string().min(1),
});

export type ImportCompletedEvent = z.infer<typeof importCompletedEventSchema>;
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @task1/shared test -- import-completed.event.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Write the failing test for `importFailedEventSchema`**

`back-end/libs/shared/src/github-archive/events/import-failed.event.spec.ts`:
```ts
import { importFailedEventSchema } from './import-failed.event.js';

describe('importFailedEventSchema', () => {
  const validPayload = {
    importId: '11111111-1111-4111-8111-111111111111',
    archive: '2026-08-11-0.json.gz',
    startedAt: '2026-08-11T00:00:00.000Z',
    failedAt: '2026-08-11T00:02:00.000Z',
    reason: 'download failed: 404 Not Found',
    correlationId: 'c1',
  };

  it('should accept a valid payload, when all fields are present and well-formed', () => {
    expect(importFailedEventSchema.parse(validPayload)).toEqual(validPayload);
  });

  it('should throw, when reason is an empty string', () => {
    expect(() => importFailedEventSchema.parse({ ...validPayload, reason: '' })).toThrow();
  });

  it('should throw, when failedAt is not an ISO datetime string', () => {
    expect(() => importFailedEventSchema.parse({ ...validPayload, failedAt: 'not-a-date' })).toThrow();
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `pnpm --filter @task1/shared test -- import-failed.event.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 11: Implement `import-failed.event.ts`**

```ts
import { z } from 'zod';

export const importFailedEventSchema = z.object({
  importId: z.uuid(),
  archive: z.string().min(1),
  startedAt: z.iso.datetime(),
  failedAt: z.iso.datetime(),
  reason: z.string().min(1),
  correlationId: z.string().min(1),
});

export type ImportFailedEvent = z.infer<typeof importFailedEventSchema>;
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `pnpm --filter @task1/shared test -- import-failed.event.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 13: Add the event-pattern constants (no test — plain constant object, no branching logic)**

`back-end/libs/shared/src/github-archive/events/event-patterns.const.ts`:
```ts
export const EVENT_PATTERNS = {
  IMPORT_STARTED: 'github.import.started',
  IMPORT_COMPLETED: 'github.import.completed',
  IMPORT_FAILED: 'github.import.failed',
} as const;

export type EventPattern = (typeof EVENT_PATTERNS)[keyof typeof EVENT_PATTERNS];
```

- [ ] **Step 14: Add the GitHub event document contract (no test — pure interfaces, no runtime logic, matching this repo's existing `*.types.ts` convention)**

`back-end/libs/shared/src/github-archive/contracts/github-event.dto.ts`:
```ts
export interface IGithubActor {
  id: number;
  login: string;
}

export interface IGithubRepository {
  id: number;
  name: string;
}

export interface IGithubOrganization {
  id: number;
  login: string;
}

export interface IGithubEventDocument {
  eventId: string;
  eventType: string;
  createdAt: Date;
  actor: IGithubActor;
  repo: IGithubRepository;
  org?: IGithubOrganization;
  importId: string;
  payload: Record<string, unknown>;
}
```

- [ ] **Step 15: Add the subfolder barrel and wire it into the package's top-level barrel**

`back-end/libs/shared/src/github-archive/index.ts`:
```ts
export * from './contracts/github-event.dto.js';
export * from './events/event-patterns.const.js';
export * from './events/import-completed.event.js';
export * from './events/import-failed.event.js';
export * from './events/import-started.event.js';
```

Modify `back-end/libs/shared/src/index.ts` — insert a new line directly after the existing `export * from './errors/index.js';` line (and the blank line that follows it), so the file starts:
```ts
export * from './errors/index.js';

export * from './github-archive/index.js';

export * from './exception-handling/error-format.service.js';
```
(the remaining lines of the file are unchanged).

- [ ] **Step 16: Run the full shared-package test suite**

Run: `pnpm --filter @task1/shared test`
Expected: PASS, all suites including the 3 new spec files.

- [ ] **Step 17: Lint and build the shared package**

Run: `pnpm --filter @task1/shared lint && pnpm --filter @task1/shared build`
Expected: both succeed with no errors (build emits the new files under `back-end/libs/shared/dist/github-archive/`).

- [ ] **Step 18: Stage the files**

```bash
git add back-end/libs/shared/src/github-archive back-end/libs/shared/src/index.ts
```

---

## Task 2: `service-a` — MongoDB, Redis, and storage configuration

**Files:**
- Create: `back-end/service-a/src/config/mongodb.config.ts`
- Create: `back-end/service-a/src/config/mongodb.config.spec.ts`
- Create: `back-end/service-a/src/config/redis.config.ts`
- Create: `back-end/service-a/src/config/redis.config.spec.ts`
- Create: `back-end/service-a/src/config/storage.config.ts`
- Create: `back-end/service-a/src/config/storage.config.spec.ts`
- Modify: `back-end/service-a/src/app.module.ts`
- Modify: `back-end/service-a/.env.example`

**Interfaces:**
- Produces: `mongodbConfig` (namespace `mongodb`, `MongodbConfiguration { uri: string; batchSize: number }`, default `uri = 'mongodb://localhost:27017/service_a'`, default `batchSize = 500`, env `MONGODB_URI`/`MONGO_BATCH_SIZE`).
- Produces: `redisConfig` (namespace `redis`, `RedisConfiguration { url: string }`, default `'redis://localhost:6379'`, env `REDIS_URL`).
- Produces: `storageConfig` (namespace `storage`, `StorageConfiguration { dir: string }`, default `'./data/archives'`, env `STORAGE_DIR`).
- Consumed later by: Task 3 (this task's `mongodbConfig.KEY`/`redisConfig.KEY`), Phase 1 (`storageConfig().dir`), Phase 2 (`mongodbConfig().batchSize`).

- [ ] **Step 1: Write the failing test for `mongodbConfig`**

`back-end/service-a/src/config/mongodb.config.spec.ts`:
```ts
import mongodbConfig from './mongodb.config.js';

describe('mongodbConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return documented defaults, when no environment variables are set', () => {
      delete process.env.MONGODB_URI;
      delete process.env.MONGO_BATCH_SIZE;

      expect(mongodbConfig()).toEqual({
        uri: 'mongodb://localhost:27017/service_a',
        batchSize: 500,
      });
    });
  });

  describe('environment overrides', () => {
    it('should parse values from environment variables, when all variables are set', () => {
      process.env.MONGODB_URI = 'mongodb://user:pass@mongo-host:27017/custom-db';
      process.env.MONGO_BATCH_SIZE = '250';

      expect(mongodbConfig()).toEqual({
        uri: 'mongodb://user:pass@mongo-host:27017/custom-db',
        batchSize: 250,
      });
    });
  });

  describe('validation', () => {
    it('should throw, when MONGODB_URI is not a valid url', () => {
      process.env.MONGODB_URI = 'not-a-valid-url';

      expect(() => mongodbConfig()).toThrow();
    });

    it('should throw, when MONGO_BATCH_SIZE is not a positive number', () => {
      process.env.MONGO_BATCH_SIZE = '0';

      expect(() => mongodbConfig()).toThrow();
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- mongodb.config.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `mongodb.config.ts`**

```ts
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const mongodbConfigSchema = z.object({
  uri: z.url().default('mongodb://localhost:27017/service_a'),
  batchSize: z.coerce.number().int().positive().default(500),
});

export type MongodbConfiguration = z.infer<typeof mongodbConfigSchema>;

export default registerAs('mongodb', (): MongodbConfiguration =>
  mongodbConfigSchema.parse({
    uri: process.env.MONGODB_URI,
    batchSize: process.env.MONGO_BATCH_SIZE,
  }),
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- mongodb.config.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing test for `redisConfig`**

`back-end/service-a/src/config/redis.config.spec.ts`:
```ts
import redisConfig from './redis.config.js';

describe('redisConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return documented defaults, when no environment variables are set', () => {
      delete process.env.REDIS_URL;

      expect(redisConfig()).toEqual({ url: 'redis://localhost:6379' });
    });
  });

  describe('environment overrides', () => {
    it('should parse values from environment variables, when all variables are set', () => {
      process.env.REDIS_URL = 'redis://redis-host:6379';

      expect(redisConfig()).toEqual({ url: 'redis://redis-host:6379' });
    });
  });

  describe('validation', () => {
    it('should throw, when REDIS_URL is not a valid url', () => {
      process.env.REDIS_URL = 'not-a-valid-url';

      expect(() => redisConfig()).toThrow();
    });
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- redis.config.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `redis.config.ts`**

```ts
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const redisConfigSchema = z.object({
  url: z.url().default('redis://localhost:6379'),
});

export type RedisConfiguration = z.infer<typeof redisConfigSchema>;

export default registerAs('redis', (): RedisConfiguration =>
  redisConfigSchema.parse({
    url: process.env.REDIS_URL,
  }),
);
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- redis.config.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Write the failing test for `storageConfig`**

`back-end/service-a/src/config/storage.config.spec.ts`:
```ts
import storageConfig from './storage.config.js';

describe('storageConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return the documented default, when no environment variable is set', () => {
      delete process.env.STORAGE_DIR;

      expect(storageConfig()).toEqual({ dir: './data/archives' });
    });
  });

  describe('environment overrides', () => {
    it('should parse the value from the environment variable, when it is set', () => {
      process.env.STORAGE_DIR = '/data/archives';

      expect(storageConfig()).toEqual({ dir: '/data/archives' });
    });
  });

  describe('validation', () => {
    it('should throw, when STORAGE_DIR is an empty string', () => {
      process.env.STORAGE_DIR = '';

      expect(() => storageConfig()).toThrow();
    });
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- storage.config.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 11: Implement `storage.config.ts`**

```ts
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const storageConfigSchema = z.object({
  dir: z.string().min(1).default('./data/archives'),
});

export type StorageConfiguration = z.infer<typeof storageConfigSchema>;

export default registerAs('storage', (): StorageConfiguration =>
  storageConfigSchema.parse({
    dir: process.env.STORAGE_DIR,
  }),
);
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- storage.config.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 13: Wire the three new namespaces into `AppModule`**

Modify `back-end/service-a/src/app.module.ts` to:
```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import loggerConfig from '@task1/shared/config/logger.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/rmq/exception-handling.module';
import { LoggerModule } from '@task1/shared/logger/rmq/logger.module';
import { RequestContextModule } from '@task1/shared/request-context/rmq/request-context.module';

import mongodbConfig from './config/mongodb.config.js';
import rabbitmqConfig from './config/rabbitmq.config.js';
import redisConfig from './config/redis.config.js';
import storageConfig from './config/storage.config.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [loggerConfig, rabbitmqConfig, mongodbConfig, redisConfig, storageConfig],
    }),
    RequestContextModule,
    LoggerModule,
    ExceptionHandlingModule,
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 14: Document the new environment variables**

Modify `back-end/service-a/.env.example` to:
```
RABBITMQ_URL=amqp://guest:guest@localhost:5672
RABBITMQ_QUEUE=service_a_queue

MONGODB_URI=mongodb://localhost:27017/service_a
MONGO_BATCH_SIZE=500

REDIS_URL=redis://localhost:6379

STORAGE_DIR=./data/archives

LOG_LEVEL=trace
APP_LOG_TRANSPORT=pretty
```

- [ ] **Step 15: Run the full `service-a` test suite**

Run: `pnpm --filter service-a test`
Expected: PASS, all suites including the 3 new spec files. (`AppModule` boots correctly when `service-a`'s existing tests run — no existing test constructs `AppModule` directly today, so this step only confirms the new config specs pass; module wiring is confirmed for real in Task 3's Step 8 once the app can actually start against Docker infra.)

- [ ] **Step 16: Stage the files**

```bash
git add back-end/service-a/src/config back-end/service-a/src/app.module.ts back-end/service-a/.env.example
```

---

## Task 3: `service-a` — MongoDB and Redis client wiring

**Files:**
- Create: `back-end/service-a/src/infra/infra-clients.tokens.ts`
- Create: `back-end/service-a/src/infra/mongo/mongo-connection.service.ts`
- Create: `back-end/service-a/src/infra/mongo/mongo-connection.service.spec.ts`
- Create: `back-end/service-a/src/infra/mongo/mongo.module.ts`
- Create: `back-end/service-a/src/infra/redis/redis-connection.service.ts`
- Create: `back-end/service-a/src/infra/redis/redis-connection.service.spec.ts`
- Create: `back-end/service-a/src/infra/redis/redis.module.ts`
- Modify: `back-end/service-a/src/app.module.ts`
- Modify: `back-end/service-a/package.json`

**Interfaces:**
- Consumes: `mongodbConfig`, `redisConfig` from Task 2.
- Produces: `MONGO_CLIENT` and `REDIS_CLIENT` DI tokens (string constants), injectable anywhere in `service-a` once `MongoModule`/`RedisModule` are imported once at the `AppModule` level (both `@Global()`). Later phases (`ImportsRepository` in Phase 2, `EventsRepository` in Phase 4) inject `MONGO_CLIENT` to get a live `MongoClient`.

- [ ] **Step 1: Add the `mongodb` and `ioredis` dependencies**

Modify `back-end/service-a/package.json` — in the `dependencies` block, insert `"ioredis": "^6.0.0",` after the `"class-validator"` line and `"mongodb": "^7.5.0",` after the newly-inserted `ioredis` line (alphabetical order, matching `api-gateway`'s existing `package.json`), so the block reads:
```json
  "dependencies": {
    "@nestjs/common": "^11.0.1",
    "@nestjs/config": "^4.0.4",
    "@nestjs/core": "^11.0.1",
    "@nestjs/microservices": "^11.0.1",
    "@nestjs/platform-express": "^11.0.1",
    "@nestjs/terminus": "^11.1.1",
    "@task1/shared": "workspace:*",
    "amqp-connection-manager": "^5.0.0",
    "amqplib": "^2.0.1",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "ioredis": "^6.0.0",
    "mongodb": "^7.5.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "zod": "^4.4.3"
  },
```

Run: `pnpm install`
Expected: lockfile updates, `node_modules/mongodb` and `node_modules/ioredis` become resolvable from `back-end/service-a`.

- [ ] **Step 2: Add the DI tokens (no test — plain string constants)**

`back-end/service-a/src/infra/infra-clients.tokens.ts`:
```ts
export const MONGO_CLIENT = 'MONGO_CLIENT';
export const REDIS_CLIENT = 'REDIS_CLIENT';
```

- [ ] **Step 3: Write the failing tests for `MongoConnectionService`**

`back-end/service-a/src/infra/mongo/mongo-connection.service.spec.ts`:
```ts
import { type LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type MongoClient } from 'mongodb';

import { MongoConnectionService } from './mongo-connection.service.js';

describe('MongoConnectionService', () => {
  let infoMock: ReturnType<typeof vi.fn>;
  let loggerService: LoggerService;

  beforeEach(() => {
    infoMock = vi.fn();
    loggerService = {
      getLogger: vi.fn().mockReturnValue({ info: infoMock }),
    } as unknown as LoggerService;
  });

  describe('onModuleInit', () => {
    it('should connect the Mongo client and log success, when initialization succeeds', async () => {
      const client = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
      } as unknown as MongoClient;
      const service = new MongoConnectionService(client, loggerService);

      await service.onModuleInit();

      expect(client.connect).toHaveBeenCalledTimes(1);
      expect(infoMock).toHaveBeenCalledWith({}, 'Connected to MongoDB');
    });

    it('should propagate the error, when the Mongo client fails to connect', async () => {
      const client = {
        connect: vi.fn().mockRejectedValue(new Error('connection refused')),
        close: vi.fn(),
      } as unknown as MongoClient;
      const service = new MongoConnectionService(client, loggerService);

      await expect(service.onModuleInit()).rejects.toThrow('connection refused');
    });
  });

  describe('onModuleDestroy', () => {
    it('should close the Mongo client, when destroyed', async () => {
      const client = {
        connect: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as MongoClient;
      const service = new MongoConnectionService(client, loggerService);

      await service.onModuleDestroy();

      expect(client.close).toHaveBeenCalledTimes(1);
    });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- mongo-connection.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `MongoConnectionService`**

`back-end/service-a/src/infra/mongo/mongo-connection.service.ts`:
```ts
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type MongoClient } from 'mongodb';

import { MONGO_CLIENT } from '../infra-clients.tokens.js';

@Injectable()
export class MongoConnectionService implements OnModuleInit, OnModuleDestroy {
  public constructor(
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
    private readonly loggerService: LoggerService,
  ) {}

  public async onModuleInit(): Promise<void> {
    await this.client.connect();

    this.loggerService.getLogger('MongoConnectionService').info({}, 'Connected to MongoDB');
  }

  public async onModuleDestroy(): Promise<void> {
    await this.client.close();
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- mongo-connection.service.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Implement `MongoModule` (no separate test — a pure DI-wiring module; correct wiring is verified in Step 15's real boot check)**

`back-end/service-a/src/infra/mongo/mongo.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { MongoClient } from 'mongodb';

import mongodbConfig from '../../config/mongodb.config.js';
import { MONGO_CLIENT } from '../infra-clients.tokens.js';

import { MongoConnectionService } from './mongo-connection.service.js';

@Global()
@Module({
  providers: [
    MongoConnectionService,
    {
      provide: MONGO_CLIENT,
      inject: [mongodbConfig.KEY],
      useFactory: (config: ConfigType<typeof mongodbConfig>) => new MongoClient(config.uri),
    },
  ],
  exports: [MONGO_CLIENT],
})
export class MongoModule {}
```

- [ ] **Step 8: Write the failing tests for `RedisConnectionService`**

`back-end/service-a/src/infra/redis/redis-connection.service.spec.ts`:
```ts
import { type LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Redis } from 'ioredis';

import { RedisConnectionService } from './redis-connection.service.js';

describe('RedisConnectionService', () => {
  let infoMock: ReturnType<typeof vi.fn>;
  let loggerService: LoggerService;

  beforeEach(() => {
    infoMock = vi.fn();
    loggerService = {
      getLogger: vi.fn().mockReturnValue({ info: infoMock }),
    } as unknown as LoggerService;
  });

  describe('onModuleInit', () => {
    it('should connect the Redis client and log success, when initialization succeeds', async () => {
      const client = {
        connect: vi.fn().mockResolvedValue(undefined),
        quit: vi.fn(),
      } as unknown as Redis;
      const service = new RedisConnectionService(client, loggerService);

      await service.onModuleInit();

      expect(client.connect).toHaveBeenCalledTimes(1);
      expect(infoMock).toHaveBeenCalledWith({}, 'Connected to Redis');
    });

    it('should propagate the error, when the Redis client fails to connect', async () => {
      const client = {
        connect: vi.fn().mockRejectedValue(new Error('connection refused')),
        quit: vi.fn(),
      } as unknown as Redis;
      const service = new RedisConnectionService(client, loggerService);

      await expect(service.onModuleInit()).rejects.toThrow('connection refused');
    });
  });

  describe('onModuleDestroy', () => {
    it('should gracefully close the Redis client, when destroyed', async () => {
      const client = {
        connect: vi.fn(),
        quit: vi.fn().mockResolvedValue('OK'),
      } as unknown as Redis;
      const service = new RedisConnectionService(client, loggerService);

      await service.onModuleDestroy();

      expect(client.quit).toHaveBeenCalledTimes(1);
    });
  });
});
```

- [ ] **Step 9: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- redis-connection.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 10: Implement `RedisConnectionService`**

`back-end/service-a/src/infra/redis/redis-connection.service.ts`:
```ts
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Redis } from 'ioredis';

import { REDIS_CLIENT } from '../infra-clients.tokens.js';

@Injectable()
export class RedisConnectionService implements OnModuleInit, OnModuleDestroy {
  public constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    private readonly loggerService: LoggerService,
  ) {}

  public async onModuleInit(): Promise<void> {
    await this.client.connect();

    this.loggerService.getLogger('RedisConnectionService').info({}, 'Connected to Redis');
  }

  public async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
```

- [ ] **Step 11: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- redis-connection.service.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 12: Implement `RedisModule`**

`back-end/service-a/src/infra/redis/redis.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { Redis } from 'ioredis';

import redisConfig from '../../config/redis.config.js';
import { REDIS_CLIENT } from '../infra-clients.tokens.js';

import { RedisConnectionService } from './redis-connection.service.js';

@Global()
@Module({
  providers: [
    RedisConnectionService,
    {
      provide: REDIS_CLIENT,
      inject: [redisConfig.KEY],
      useFactory: (config: ConfigType<typeof redisConfig>) => {
        const client = new Redis(config.url, { lazyConnect: true });

        // ioredis emits 'error' on a lazily-connected client before connect()
        // resolves or rejects; without a listener this crashes the process
        // (unhandled EventEmitter 'error' event). RedisConnectionService's own
        // connect() call surfaces real connection failures via its rejected
        // promise instead — this listener only prevents the process crash.
        // eslint-disable-next-line @typescript-eslint/no-empty-function -- deliberately swallowed; see comment above.
        client.on('error', () => {});

        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
```

- [ ] **Step 13: Wire `MongoModule` and `RedisModule` into `AppModule`**

Modify `back-end/service-a/src/app.module.ts` to:
```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import loggerConfig from '@task1/shared/config/logger.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/rmq/exception-handling.module';
import { LoggerModule } from '@task1/shared/logger/rmq/logger.module';
import { RequestContextModule } from '@task1/shared/request-context/rmq/request-context.module';

import mongodbConfig from './config/mongodb.config.js';
import rabbitmqConfig from './config/rabbitmq.config.js';
import redisConfig from './config/redis.config.js';
import storageConfig from './config/storage.config.js';
import { HealthModule } from './health/health.module.js';
import { MongoModule } from './infra/mongo/mongo.module.js';
import { RedisModule } from './infra/redis/redis.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [loggerConfig, rabbitmqConfig, mongodbConfig, redisConfig, storageConfig],
    }),
    RequestContextModule,
    LoggerModule,
    ExceptionHandlingModule,
    MongoModule,
    RedisModule,
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 14: Run the full `service-a` test suite and lint**

Run: `pnpm --filter service-a test && pnpm --filter service-a lint`
Expected: both PASS.

- [ ] **Step 15: Stage the files**

```bash
git add back-end/service-a/src/infra back-end/service-a/src/app.module.ts back-end/service-a/package.json pnpm-lock.yaml
```

---

## Task 4: `service-b` — MongoDB and Redis configuration

**Files:**
- Create: `back-end/service-b/src/config/mongodb.config.ts`
- Create: `back-end/service-b/src/config/mongodb.config.spec.ts`
- Create: `back-end/service-b/src/config/redis.config.ts`
- Create: `back-end/service-b/src/config/redis.config.spec.ts`
- Modify: `back-end/service-b/src/app.module.ts`
- Modify: `back-end/service-b/.env.example`

**Interfaces:**
- Produces: `mongodbConfig` (namespace `mongodb`, `MongodbConfiguration { uri: string }` — **no `batchSize`**: `service-b` never batch-inserts archive events, it only upserts one log document per lifecycle event, so this field would be an unused, speculative addition; default `'mongodb://localhost:27017/service_b'`, env `MONGODB_URI`).
- Produces: `redisConfig` (namespace `redis`, `RedisConfiguration { url: string }`, default `'redis://localhost:6379'`, env `REDIS_URL`) — identical shape to `service-a`'s.

- [ ] **Step 1: Write the failing test for `mongodbConfig`**

`back-end/service-b/src/config/mongodb.config.spec.ts`:
```ts
import mongodbConfig from './mongodb.config.js';

describe('mongodbConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return the documented default, when no environment variable is set', () => {
      delete process.env.MONGODB_URI;

      expect(mongodbConfig()).toEqual({ uri: 'mongodb://localhost:27017/service_b' });
    });
  });

  describe('environment overrides', () => {
    it('should parse the value from the environment variable, when it is set', () => {
      process.env.MONGODB_URI = 'mongodb://user:pass@mongo-host:27017/custom-db';

      expect(mongodbConfig()).toEqual({ uri: 'mongodb://user:pass@mongo-host:27017/custom-db' });
    });
  });

  describe('validation', () => {
    it('should throw, when MONGODB_URI is not a valid url', () => {
      process.env.MONGODB_URI = 'not-a-valid-url';

      expect(() => mongodbConfig()).toThrow();
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- mongodb.config.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `mongodb.config.ts`**

```ts
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const mongodbConfigSchema = z.object({
  uri: z.url().default('mongodb://localhost:27017/service_b'),
});

export type MongodbConfiguration = z.infer<typeof mongodbConfigSchema>;

export default registerAs('mongodb', (): MongodbConfiguration =>
  mongodbConfigSchema.parse({
    uri: process.env.MONGODB_URI,
  }),
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- mongodb.config.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test for `redisConfig`**

`back-end/service-b/src/config/redis.config.spec.ts`:
```ts
import redisConfig from './redis.config.js';

describe('redisConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return the documented default, when no environment variable is set', () => {
      delete process.env.REDIS_URL;

      expect(redisConfig()).toEqual({ url: 'redis://localhost:6379' });
    });
  });

  describe('environment overrides', () => {
    it('should parse the value from the environment variable, when it is set', () => {
      process.env.REDIS_URL = 'redis://redis-host:6379';

      expect(redisConfig()).toEqual({ url: 'redis://redis-host:6379' });
    });
  });

  describe('validation', () => {
    it('should throw, when REDIS_URL is not a valid url', () => {
      process.env.REDIS_URL = 'not-a-valid-url';

      expect(() => redisConfig()).toThrow();
    });
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- redis.config.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `redis.config.ts`**

```ts
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const redisConfigSchema = z.object({
  url: z.url().default('redis://localhost:6379'),
});

export type RedisConfiguration = z.infer<typeof redisConfigSchema>;

export default registerAs('redis', (): RedisConfiguration =>
  redisConfigSchema.parse({
    url: process.env.REDIS_URL,
  }),
);
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- redis.config.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Wire the two new namespaces into `AppModule`**

Modify `back-end/service-b/src/app.module.ts` to:
```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import loggerConfig from '@task1/shared/config/logger.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/rmq/exception-handling.module';
import { LoggerModule } from '@task1/shared/logger/rmq/logger.module';
import { RequestContextModule } from '@task1/shared/request-context/rmq/request-context.module';

import mongodbConfig from './config/mongodb.config.js';
import rabbitmqConfig from './config/rabbitmq.config.js';
import redisConfig from './config/redis.config.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [loggerConfig, rabbitmqConfig, mongodbConfig, redisConfig],
    }),
    RequestContextModule,
    LoggerModule,
    ExceptionHandlingModule,
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 10: Document the new environment variables**

Modify `back-end/service-b/.env.example` to:
```
RABBITMQ_URL=amqp://guest:guest@localhost:5672
RABBITMQ_QUEUE=service_b_queue

MONGODB_URI=mongodb://localhost:27017/service_b

REDIS_URL=redis://localhost:6379

LOG_LEVEL=trace
APP_LOG_TRANSPORT=pretty
```

- [ ] **Step 11: Run the full `service-b` test suite**

Run: `pnpm --filter service-b test`
Expected: PASS.

- [ ] **Step 12: Stage the files**

```bash
git add back-end/service-b/src/config back-end/service-b/src/app.module.ts back-end/service-b/.env.example
```

---

## Task 5: `service-b` — MongoDB and Redis client wiring

**Files:**
- Create: `back-end/service-b/src/infra/infra-clients.tokens.ts`
- Create: `back-end/service-b/src/infra/mongo/mongo-connection.service.ts`
- Create: `back-end/service-b/src/infra/mongo/mongo-connection.service.spec.ts`
- Create: `back-end/service-b/src/infra/mongo/mongo.module.ts`
- Create: `back-end/service-b/src/infra/redis/redis-connection.service.ts`
- Create: `back-end/service-b/src/infra/redis/redis-connection.service.spec.ts`
- Create: `back-end/service-b/src/infra/redis/redis.module.ts`
- Modify: `back-end/service-b/src/app.module.ts`
- Modify: `back-end/service-b/package.json`

**Interfaces:** identical shape to Task 3, scoped to `service-b` (its own `MONGO_CLIENT`/`REDIS_CLIENT` tokens in its own DI container — no cross-service sharing, per the module-boundary rule).

- [ ] **Step 1: Add the `mongodb` and `ioredis` dependencies**

Modify `back-end/service-b/package.json` — identical edit to Task 3 Step 1, applied to `back-end/service-b/package.json`:
```json
  "dependencies": {
    "@nestjs/common": "^11.0.1",
    "@nestjs/config": "^4.0.4",
    "@nestjs/core": "^11.0.1",
    "@nestjs/microservices": "^11.0.1",
    "@nestjs/platform-express": "^11.0.1",
    "@nestjs/terminus": "^11.1.1",
    "@task1/shared": "workspace:*",
    "amqp-connection-manager": "^5.0.0",
    "amqplib": "^2.0.1",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "ioredis": "^6.0.0",
    "mongodb": "^7.5.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "zod": "^4.4.3"
  },
```

Run: `pnpm install`
Expected: lockfile updates, `node_modules/mongodb` and `node_modules/ioredis` become resolvable from `back-end/service-b`.

- [ ] **Step 2: Add the DI tokens**

`back-end/service-b/src/infra/infra-clients.tokens.ts`:
```ts
export const MONGO_CLIENT = 'MONGO_CLIENT';
export const REDIS_CLIENT = 'REDIS_CLIENT';
```

- [ ] **Step 3: Write the failing tests for `MongoConnectionService`**

`back-end/service-b/src/infra/mongo/mongo-connection.service.spec.ts` — identical content to `back-end/service-a/src/infra/mongo/mongo-connection.service.spec.ts` (Task 3, Step 3).

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- mongo-connection.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `MongoConnectionService`**

`back-end/service-b/src/infra/mongo/mongo-connection.service.ts` — identical content to `back-end/service-a/src/infra/mongo/mongo-connection.service.ts` (Task 3, Step 5).

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- mongo-connection.service.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Implement `MongoModule`**

`back-end/service-b/src/infra/mongo/mongo.module.ts` — identical content to `back-end/service-a/src/infra/mongo/mongo.module.ts` (Task 3, Step 7).

- [ ] **Step 8: Write the failing tests for `RedisConnectionService`**

`back-end/service-b/src/infra/redis/redis-connection.service.spec.ts` — identical content to `back-end/service-a/src/infra/redis/redis-connection.service.spec.ts` (Task 3, Step 8).

- [ ] **Step 9: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- redis-connection.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 10: Implement `RedisConnectionService`**

`back-end/service-b/src/infra/redis/redis-connection.service.ts` — identical content to `back-end/service-a/src/infra/redis/redis-connection.service.ts` (Task 3, Step 10).

- [ ] **Step 11: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- redis-connection.service.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 12: Implement `RedisModule`**

`back-end/service-b/src/infra/redis/redis.module.ts` — identical content to `back-end/service-a/src/infra/redis/redis.module.ts` (Task 3, Step 12).

- [ ] **Step 13: Wire `MongoModule` and `RedisModule` into `AppModule`**

Modify `back-end/service-b/src/app.module.ts` to:
```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import loggerConfig from '@task1/shared/config/logger.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/rmq/exception-handling.module';
import { LoggerModule } from '@task1/shared/logger/rmq/logger.module';
import { RequestContextModule } from '@task1/shared/request-context/rmq/request-context.module';

import mongodbConfig from './config/mongodb.config.js';
import rabbitmqConfig from './config/rabbitmq.config.js';
import redisConfig from './config/redis.config.js';
import { HealthModule } from './health/health.module.js';
import { MongoModule } from './infra/mongo/mongo.module.js';
import { RedisModule } from './infra/redis/redis.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [loggerConfig, rabbitmqConfig, mongodbConfig, redisConfig],
    }),
    RequestContextModule,
    LoggerModule,
    ExceptionHandlingModule,
    MongoModule,
    RedisModule,
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 14: Run the full `service-b` test suite and lint**

Run: `pnpm --filter service-b test && pnpm --filter service-b lint`
Expected: both PASS.

- [ ] **Step 15: Stage the files**

```bash
git add back-end/service-b/src/infra back-end/service-b/src/app.module.ts back-end/service-b/package.json pnpm-lock.yaml
```

---

## Task 6: Docker Compose infrastructure changes

**Files:**
- Modify: `docker-compose.yml`

**Interfaces:** none (infrastructure-only; no application code reads these values until Phase 1 (`STORAGE_DIR`) and later phases (`MONGODB_URI`/`REDIS_URL` are already consumed by Task 2/4's config namespaces)).

- [ ] **Step 1: Swap the Redis image and add the archive-storage volume**

Modify `docker-compose.yml`'s `redis` service and top-level `volumes:` section (RedisTimeSeries requires the Redis Stack module — plain `redis:7-alpine` doesn't have it; `redis-cli ping` still works against `redis-stack-server` since it's a superset of standard Redis):

```yaml
name: task1

x-rabbitmq-url: &rabbitmq_url
  RABBITMQ_URL: amqp://guest:guest@rabbitmq:5672

services:
  rabbitmq:
    image: rabbitmq:3-management-alpine
    container_name: task1-rabbitmq
    restart: unless-stopped
    ports:
      - "5672:5672"
      - "15672:15672"
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

  mongodb:
    image: mongo:7
    container_name: task1-mongodb
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "mongosh", "--quiet", "--eval", "db.adminCommand('ping')"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis/redis-stack-server:latest
    container_name: task1-redis
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

  service-b:
    container_name: task1-service-b
    build:
      context: .
      dockerfile: back-end/service-b/Dockerfile
      target: runtime
    restart: unless-stopped
    environment:
      <<: *rabbitmq_url
      RABBITMQ_QUEUE: service_b_queue
      MONGODB_URI: mongodb://mongodb:27017/service_b
      REDIS_URL: redis://redis:6379
    depends_on:
      rabbitmq:
        condition: service_healthy
      mongodb:
        condition: service_healthy
      redis:
        condition: service_healthy

  service-a:
    container_name: task1-service-a
    build:
      context: .
      dockerfile: back-end/service-a/Dockerfile
      target: runtime
    restart: unless-stopped
    environment:
      <<: *rabbitmq_url
      RABBITMQ_QUEUE: service_a_queue
      MONGODB_URI: mongodb://mongodb:27017/service_a
      MONGO_BATCH_SIZE: 500
      REDIS_URL: redis://redis:6379
      STORAGE_DIR: /data/archives
    volumes:
      - archive-storage:/data/archives
    depends_on:
      rabbitmq:
        condition: service_healthy
      mongodb:
        condition: service_healthy
      redis:
        condition: service_healthy

  api-gateway:
    container_name: task1-api-gateway
    build:
      context: .
      dockerfile: back-end/api-gateway/Dockerfile
      target: runtime
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      <<: *rabbitmq_url
      PORT: 3000
      RABBITMQ_SERVICE_B_QUEUE: service_b_queue
      RABBITMQ_SERVICE_A_QUEUE: service_a_queue
      MONGODB_URI: mongodb://mongodb:27017/gateway
      REDIS_URL: redis://redis:6379
    depends_on:
      rabbitmq:
        condition: service_healthy
      mongodb:
        condition: service_healthy
      redis:
        condition: service_healthy

  front-end:
    container_name: task1-front-end
    build:
      context: .
      dockerfile: front-end/Dockerfile
    restart: unless-stopped
    ports:
      - "4200:80"
    depends_on:
      - api-gateway

volumes:
  archive-storage:
```

(`api-gateway`'s own `STORAGE_DIR`/volume mount for the upload endpoint is deliberately deferred to Phase 3 — nothing reads it until then, and mounting an unused volume now would be speculative.)

- [ ] **Step 2: Stage the file**

```bash
git add docker-compose.yml
```

---

## Task 7: End-to-end verification

**Files:** none — this task only runs commands and reads output; it is the "does everything actually connect" checkpoint the earlier unit tests can't cover (they mock every external dependency, per this repo's testing convention).

- [ ] **Step 1: Build all workspace packages**

Run: `pnpm build`
Expected: succeeds for `@task1/shared`, `service-a`, `service-b`, `api-gateway`, `front-end` — confirms the new `github-archive/` exports compile and are resolvable from both services via `@task1/shared/github-archive/...` subpath imports.

- [ ] **Step 2: Start the full stack**

Run: `pnpm docker:up`
Expected: all containers reach a healthy/running state, including `task1-redis` (now `redis/redis-stack-server`) passing its `redis-cli ping` healthcheck.

- [ ] **Step 3: Confirm `service-a` connected to Mongo and Redis at boot**

Run: `docker compose logs service-a`
Expected: log lines containing `"Connected to MongoDB"` and `"Connected to Redis"` (both from the new connection services), with no fatal/error-level lines.

- [ ] **Step 4: Confirm `service-b` connected to Mongo and Redis at boot**

Run: `docker compose logs service-b`
Expected: same two log lines, no fatal/error-level lines.

- [ ] **Step 5: Confirm RedisTimeSeries is available**

Run: `docker compose exec redis redis-cli TS.CREATE phase0.smoke.test`
Expected: `OK` — proves the `TS.*` command family is available (would fail with `unknown command 'TS.CREATE'` on plain `redis:7-alpine`).

Run: `docker compose exec redis redis-cli DEL phase0.smoke.test`
Expected: `(integer) 1` — cleans up the smoke-test key so it doesn't linger as unexplained state.

- [ ] **Step 6: Tear down**

Run: `pnpm docker:down`
Expected: all containers stop cleanly (each service's `onModuleDestroy` closes its Mongo/Redis connections during shutdown — no hung processes or forced kills needed).

---

## Self-Review

**Spec coverage:** every piece of the design doc's "Infrastructure changes" and "Shared package additions" sections, plus the `service-a`/`service-b` halves of "Current state" that this phase changes, maps to a task above: shared event/contract types (Task 1), `service-a` config (Task 2) + client wiring (Task 3), `service-b` config (Task 4) + client wiring (Task 5), docker-compose (Task 6), verification (Task 7). Business logic (download, processing, search, etc.) is explicitly out of scope for this phase per the roadmap — nothing here should read like it belongs to a later phase, and nothing does.

**Placeholder scan:** no TBD/TODO; every step shows complete file contents or an exact runnable command with expected output.

**Type/name consistency:** `MONGO_CLIENT`/`REDIS_CLIENT` tokens are identical strings in both services (safe — separate DI containers, no collision). `mongodbConfig`/`redisConfig`/`storageConfig` namespace names (`'mongodb'`, `'redis'`, `'storage'`) and field names (`uri`, `batchSize`, `url`, `dir`) are consistent between the type each config file exports and how Task 3/5's modules inject `ConfigType<typeof mongodbConfig>`/`redisConfig`. `MongoConnectionService`/`RedisConnectionService` constructor signatures (`(client, loggerService)`) match exactly between their implementation and their spec files, and between `service-a`'s and `service-b`'s copies.
