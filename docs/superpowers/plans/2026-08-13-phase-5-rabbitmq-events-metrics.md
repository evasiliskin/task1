# Phase 5: Service-a RabbitMQ Domain Events & RedisTimeSeries Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `importArchive(source, importId, correlationId, dependencies): Promise<ImportResult>` — the
orchestration that ties Phase 1's `downloadArchive` and Phase 2/3's `processArchive` into one real,
observable import run: emits `github.import.started/.completed/.failed` over RabbitMQ, records
RedisTimeSeries metrics, and tracks each run in a new `imports` MongoDB collection (so a client-supplied
`Idempotency-Key` can be honored). Both the download path (new) and the upload path (Phase 3, existing)
are wired through it, so every import — however it started — is observable the same way.

**Architecture:** `importArchive` itself is a **pure orchestration function** (no NestJS, no driver
types in its signature) taking a small dependency bag of plain functions — the exact seam-injection style
Phase 1/2 already established (`downloadArchive`'s `httpGet?`, `processArchive`'s `onInvalidLine?`), scaled
up to five collaborators instead of one. A thin `ImportOrchestrationService` supplies the real
collaborators via DI: a new `ArchiveDownloadService` (wraps Phase 1's `downloadArchive`, mirroring how
Phase 3's `ArchiveProcessingService` already wraps Phase 2's `processArchive`), a new `MetricsService`
(RedisTimeSeries, added to the existing global `RedisModule`), a new `ImportRunTracker` (owns a new
`imports` collection, mirroring the existing `EVENTS_COLLECTION` provider pattern), and a new outbound
`SERVICE_B_RMQ_CLIENT` `ClientProxy` (service-a has only ever *listened* on RabbitMQ until now — this is
its first outbound client, built exactly like the gateway's existing `SERVICE_A_RMQ_CLIENT`). Two RMQ
entry points call it: the existing `UploadImportController` (modified to route through
`ImportOrchestrationService` instead of calling `ArchiveProcessingService` directly) and a new
`DownloadImportController`, which also does the `Idempotency-Key` replay check (via `ImportRunTracker`)
before ever starting an import — keeping that persistence-boundary check inside service-a, never in the
gateway. The gateway gains a new `POST /v1/imports` (download-triggered) endpoint, matching the existing
`POST /v1/imports/upload` shape, that resolves an `importId` from an optional `Idempotency-Key` header (or
generates one) and fire-and-forgets the trigger — it never touches Mongo itself.

**Tech Stack:** `@nestjs/microservices` (`ClientsModule.registerAsync`, matching the gateway's existing
pattern), official `mongodb` driver (already a `service-a` dependency), `ioredis` (already a `service-a`
dependency, `client.call('TS.ADD', ...)` for RedisTimeSeries — no new npm dependency), `class-validator`
(already a dependency, first real use for a JSON `@Body()` DTO in this codebase), Zod, Vitest.

**Design doc:** `docs/superpowers/specs/2026-08-12-github-archive-platform-design.md` (sections "Service-a:
RabbitMQ domain events (Phase 5)", "Service-a: RedisTimeSeries metrics (Phase 5)", the `imports` collection
part of "Data model", and the Phase 10 "API Gateway" section's `Idempotency-Key` note)
**Roadmap:** `docs/superpowers/plans/2026-08-12-github-archive-platform-plan.md` (Phase 5 of 11)
**Depends on:** Phase 0, Phase 1, Phase 2, Phase 3 — all already merged. Every file path, type, and
function signature below was read from the actual current code in this repo (not the roadmap's
higher-level sketch, which names a `MetricsService`/`RedisClientService` that Phase 0 never actually built
— Phase 0's real deliverable was a bare `REDIS_CLIENT` token and `RedisConnectionService`; `MetricsService`
does not exist yet anywhere in this codebase and is this phase's job to build).

Every piece of code below was checked against this exact codebase (`back-end/service-a/src/**`,
`back-end/api-gateway/src/**`, `back-end/libs/shared/src/**`) before this plan was written. Three
non-obvious findings and one deliberate scope decision are called out below because they will otherwise
cost real time or produce a design that silently diverges from what actually exists.

## Global Constraints

- **Finding 1 — `TS.ADD` auto-creates the key; a separate idempotent `TS.CREATE` is unnecessary.**
  The design doc's prose says "idempotently `TS.CREATE` each metric key... ignoring already-exists
  errors" then "`TS.ADD` calls happen inline." Checked against RedisTimeSeries's own documentation
  (Context7 `/redistimeseries/redistimeseries`): `TS.ADD key timestamp value [RETENTION ms] ...` — "If
  the time series does not exist, it is created automatically" — so passing `RETENTION` on every `TS.ADD`
  call achieves the exact same self-bounding-memory goal the design doc asks for, with no separate
  creation call, no "already exists" error to swallow, and no startup-time registration list to keep in
  sync with the metric keys actually used. `*` is RedisTimeSeries's documented automatic-timestamp token
  (server-filled time tag). `MetricsService.recordMetric` (Task 3) uses this directly — this is a
  simplification of *how* the design doc's requirement is met, not a change to *what* it requires
  (retention-bounded, idempotent, never-throws metric recording).
- **Finding 2 — service-a has never had an outbound RabbitMQ client.** Every existing `@MessagePattern`/
  `@EventPattern` in `service-a` only *listens* on its own `service_a_queue`. The gateway already has the
  exact pattern this phase needs for service-a to *emit*: `back-end/api-gateway/src/imports/
  rabbitmq-client.token.ts` + `imports.module.ts`'s `ClientsModule.registerAsync([{ name:
  SERVICE_A_RMQ_CLIENT, inject: [rabbitmqConfig.KEY], useFactory: (config) => ({ transport: Transport.RMQ,
  options: { urls: [config.url], queue: config.serviceAQueue, queueOptions: { durable: true } } }) }])`.
  Task 8 below builds the mirror image of this in `service-a`, targeting `service_b_queue`, and Task 1
  adds the missing `serviceBQueue` field to `service-a`'s own `rabbitmq.config.ts` (today it only has
  `url`/`queue`, where `queue` is service-a's *own inbound* queue — there is no field yet for a queue it
  doesn't own).
- **Finding 3 — no `imports` collection exists yet.** The roadmap's Phase 2 entry mentions an
  `ImportsRepository`, but Phase 2's actual merged plan never built one (only the `events` collection's
  unique index). This phase builds it from scratch. Per `CLAUDE.md`'s explicit "Do not introduce
  Repository pattern unless explicitly requested" and this codebase's own established convention
  (`events-collection.provider.ts` + `createEventsCollection`, a plain factory function + DI token, not a
  `Repository` class), the new `imports` collection follows the identical shape: a plain
  `imports-collection.provider.ts` + a plain `ImportRunTracker` injectable with focused, named methods —
  never a generic `Repository` abstraction.
- **Scope decision — this phase writes `started`/`completed`/`failed` only, not the design doc's
  intermediate `processing` status.** Nothing observes a distinct `processing` transition without a
  status-polling endpoint (that's Phase 10's `GET /v1/imports/:id`); persisting a status nothing reads
  yet would be dead state. Phase 10 can add it if the endpoint's UX turns out to need finer granularity —
  documented trade-off, not an oversight, matching this repo's existing style (see Phase 2's Global
  Constraints on which indexes it deliberately did and didn't create).
- **Scope decision — `service_a.api.requests/.success/.errors` metrics are out of scope for this phase.**
  The design doc lists them alongside the archive-specific metrics, but they describe a *generic*
  cross-cutting request counter that would need a global RMQ interceptor applied to every message
  pattern (health check, upload, download, search once Phase 4 lands) — a separate cross-cutting
  component the design doc doesn't specify a hook for. Building it now would be speculative
  architecture beyond what's given. This phase wires exactly the metrics tied to the import pipeline
  itself: `service_a.archive.download.duration`, `.processing.duration`, `.events.processed`,
  `.events.invalid`, `.processing.errors`.
- **Scope decision — correlationId propagation on `emit()` calls is not fixed in this phase.** The
  existing (Phase 3) `UploadImportController`'s gateway-side `emit('archive.process.upload', ...)` call
  does not forward the HTTP request's correlation ID (unlike `RabbitMqPingHealthIndicator`, which does,
  via `RmqRecordBuilder`+`buildOutboundHeaders`, for its `send()` call). Both today's upload path and
  this phase's new download-trigger path get a **fresh** correlation ID inside `service-a` (via
  `RmqContextInterceptor`'s `resolveId(undefined) → randomUUID()`), not the originating gateway request's.
  Fixing this is Phase 3's scope, not this phase's — this plan follows the existing precedent for the new
  endpoint rather than fixing one path and leaving the other inconsistent.
- Never throw raw `Error` — no new `AppError` subclass is needed in this phase: every failure this phase's
  new code can produce either propagates an existing typed error (`ArchiveDownloadError`,
  `ArchiveProcessingError`, both already `AppError` subclasses) or is a validation failure the existing
  `ValidationError` base (gateway's `imports/errors.ts`) already covers.
- `unicorn/prevent-abbreviations`, `security/detect-non-literal-fs-filename`, `@typescript-eslint/
  consistent-type-imports` (inline `type` modifiers), `import-x/order` (grouped, alphabetized, blank line
  between groups), `@typescript-eslint/naming-convention` (`I`-prefixed interfaces, unprefixed `type`
  aliases), `padding-line-between-statements` (blank line before every `return`/`throw` after a
  statement, and before every `if`) — all exactly as established in Phases 0-3's Global Constraints;
  not repeated in full here.
- No `git commit` in any step — every "commit" checkpoint is written as "stage the files."
- BDD test naming: `it('should X, when Y')`. Coverage thresholds: 90% lines, 90% branches. Mocking
  convention: plain object literals cast `as unknown as <RealType>`, never `vi.mock()`.
- Real UUID-shaped literals in every test fixture and DTO example (`skills/backend-development.md`'s UUID
  Identifiers rule) — e.g. `a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`, matching the literal already used by
  Phase 3's own tests, reused here for continuity across the same importId in examples.

---

## Task 1: `service-a` — add `serviceBQueue` to `rabbitmq.config.ts`

**Files:**
- Modify: `back-end/service-a/src/config/rabbitmq.config.ts`
- Modify: `back-end/service-a/src/config/rabbitmq.config.spec.ts`

**Interfaces:**
- Produces: `RabbitmqConfiguration { url: string; queue: string; serviceBQueue: string }` — adds
  `serviceBQueue` (default `'service_b_queue'`, env `RABBITMQ_SERVICE_B_QUEUE`) alongside the existing
  `url`/`queue` fields, unchanged.
- Consumed by: Task 8 (`ClientsModule.registerAsync` for the new outbound `SERVICE_B_RMQ_CLIENT`).

- [ ] **Step 1: Write the failing test**

Modify `back-end/service-a/src/config/rabbitmq.config.spec.ts` to:
```ts
import rabbitmqConfig from './rabbitmq.config.js';

describe('rabbitmqConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return documented defaults, when no environment variables are set', () => {
      delete process.env.RABBITMQ_URL;
      delete process.env.RABBITMQ_QUEUE;
      delete process.env.RABBITMQ_SERVICE_B_QUEUE;

      expect(rabbitmqConfig()).toEqual({
        url: 'amqp://guest:guest@localhost:5672',
        queue: 'service_a_queue',
        serviceBQueue: 'service_b_queue',
      });
    });
  });

  describe('environment overrides', () => {
    it('should parse values from environment variables, when all variables are set', () => {
      process.env.RABBITMQ_URL = 'amqp://user:pass@rabbit-host:5672';
      process.env.RABBITMQ_QUEUE = 'custom_service_a_queue';
      process.env.RABBITMQ_SERVICE_B_QUEUE = 'custom_service_b_queue';

      expect(rabbitmqConfig()).toEqual({
        url: 'amqp://user:pass@rabbit-host:5672',
        queue: 'custom_service_a_queue',
        serviceBQueue: 'custom_service_b_queue',
      });
    });
  });

  describe('validation', () => {
    it('should throw, when RABBITMQ_URL is not a valid url', () => {
      process.env.RABBITMQ_URL = 'not-a-valid-url';

      expect(() => rabbitmqConfig()).toThrow();
    });

    it('should throw, when RABBITMQ_QUEUE is an empty string', () => {
      process.env.RABBITMQ_QUEUE = '';

      expect(() => rabbitmqConfig()).toThrow();
    });

    it('should throw, when RABBITMQ_SERVICE_B_QUEUE is an empty string', () => {
      process.env.RABBITMQ_SERVICE_B_QUEUE = '';

      expect(() => rabbitmqConfig()).toThrow();
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- rabbitmq.config.spec.ts`
Expected: FAIL — the `defaults`/`environment overrides` cases fail because `serviceBQueue` is `undefined`
in the actual result; the new validation case fails because the schema doesn't have that field yet to
reject.

- [ ] **Step 3: Implement the change**

Modify `back-end/service-a/src/config/rabbitmq.config.ts` to:
```ts
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const rabbitmqConfigSchema = z.object({
  url: z.url().default('amqp://guest:guest@localhost:5672'),
  queue: z.string().min(1).default('service_a_queue'),
  serviceBQueue: z.string().min(1).default('service_b_queue'),
});

export type RabbitmqConfiguration = z.infer<typeof rabbitmqConfigSchema>;

export default registerAs('rabbitmq', (): RabbitmqConfiguration =>
  rabbitmqConfigSchema.parse({
    url: process.env.RABBITMQ_URL,
    queue: process.env.RABBITMQ_QUEUE,
    serviceBQueue: process.env.RABBITMQ_SERVICE_B_QUEUE,
  }),
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- rabbitmq.config.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/config/rabbitmq.config.ts back-end/service-a/src/config/rabbitmq.config.spec.ts
```

---

## Task 2: `service-a` — add `metricsRetentionMs` to `redis.config.ts`

**Files:**
- Modify: `back-end/service-a/src/config/redis.config.ts`
- Modify: `back-end/service-a/src/config/redis.config.spec.ts`

**Interfaces:**
- Produces: `RedisConfiguration { url: string; metricsRetentionMs: number }` — adds
  `metricsRetentionMs` (default `604_800_000` — 7 days in ms, matching the design doc's example
  retention window, env `REDIS_METRICS_RETENTION_MS`) alongside the existing `url` field.
- Consumed by: Task 3 (`MetricsService.recordMetric`'s `RETENTION` argument).

- [ ] **Step 1: Write the failing test**

Modify `back-end/service-a/src/config/redis.config.spec.ts` to:
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
      delete process.env.REDIS_METRICS_RETENTION_MS;

      expect(redisConfig()).toEqual({ url: 'redis://localhost:6379', metricsRetentionMs: 604_800_000 });
    });
  });

  describe('environment overrides', () => {
    it('should parse values from environment variables, when all variables are set', () => {
      process.env.REDIS_URL = 'redis://redis-host:6379';
      process.env.REDIS_METRICS_RETENTION_MS = '3600000';

      expect(redisConfig()).toEqual({ url: 'redis://redis-host:6379', metricsRetentionMs: 3_600_000 });
    });
  });

  describe('validation', () => {
    it('should throw, when REDIS_URL is not a valid url', () => {
      process.env.REDIS_URL = 'not-a-valid-url';

      expect(() => redisConfig()).toThrow();
    });

    it('should throw, when REDIS_METRICS_RETENTION_MS is not a positive number', () => {
      process.env.REDIS_METRICS_RETENTION_MS = '0';

      expect(() => redisConfig()).toThrow();
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- redis.config.spec.ts`
Expected: FAIL — `metricsRetentionMs` missing from the parsed result; the new validation case has
nothing to reject.

- [ ] **Step 3: Implement the change**

Modify `back-end/service-a/src/config/redis.config.ts` to:
```ts
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const SEVEN_DAYS_MS = 604_800_000;

const redisConfigSchema = z.object({
  url: z.url().default('redis://localhost:6379'),
  metricsRetentionMs: z.coerce.number().int().positive().default(SEVEN_DAYS_MS),
});

export type RedisConfiguration = z.infer<typeof redisConfigSchema>;

export default registerAs('redis', (): RedisConfiguration =>
  redisConfigSchema.parse({
    url: process.env.REDIS_URL,
    metricsRetentionMs: process.env.REDIS_METRICS_RETENTION_MS,
  }),
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- redis.config.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/config/redis.config.ts back-end/service-a/src/config/redis.config.spec.ts
```

---

## Task 3: `service-a` — `MetricsService` (RedisTimeSeries)

**Files:**
- Create: `back-end/service-a/src/infra/redis/metrics.service.ts`
- Create: `back-end/service-a/src/infra/redis/metrics.service.spec.ts`
- Modify: `back-end/service-a/src/infra/redis/redis.module.ts`

**Interfaces:**
- Consumes: `REDIS_CLIENT` (Phase 0), `redisConfig` (Task 2), `LoggerService` (`@task1/shared`).
- Produces: `MetricsService.recordMetric(key: string, value: number): Promise<void>` — never throws;
  logs a warning and resolves on any Redis failure (per the design doc: "A metrics failure... is logged
  and swallowed, never allowed to fail the primary import").
- Consumed by: Task 7 (`ArchiveDownloadService`... no — Task 9's `ImportOrchestrationService`) and
  Task 6's `import-archive.ts` (via the dependency bag, not a direct import).

- [ ] **Step 1: Write the failing tests**

`back-end/service-a/src/infra/redis/metrics.service.spec.ts`:
```ts
import { type LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Redis } from 'ioredis';

import { type RedisConfiguration } from '../../config/redis.config.js';

import { MetricsService } from './metrics.service.js';

describe('MetricsService', () => {
  const redisConfiguration: RedisConfiguration = {
    url: 'redis://localhost:6379',
    metricsRetentionMs: 604_800_000,
  };

  function buildService(
    call: ReturnType<typeof vi.fn>,
    warnMock: ReturnType<typeof vi.fn>,
  ): MetricsService {
    const client = { call } as unknown as Redis;
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ warn: warnMock }),
    } as unknown as LoggerService;

    return new MetricsService(client, redisConfiguration, loggerService);
  }

  describe('recordMetric', () => {
    it('should call TS.ADD with an automatic timestamp and the configured retention, when Redis is reachable', async () => {
      const call = vi.fn().mockResolvedValue(1_700_000_000_000);
      const warnMock = vi.fn();
      const service = buildService(call, warnMock);

      await service.recordMetric('service_a.archive.events.processed', 42);

      expect(call).toHaveBeenCalledWith(
        'TS.ADD',
        'service_a.archive.events.processed',
        '*',
        42,
        'RETENTION',
        604_800_000,
      );
      expect(warnMock).not.toHaveBeenCalled();
    });

    it('should log a warning and resolve without throwing, when Redis rejects the call', async () => {
      const call = vi.fn().mockRejectedValue(new Error('connection lost'));
      const warnMock = vi.fn();
      const service = buildService(call, warnMock);

      await expect(service.recordMetric('service_a.archive.events.processed', 42)).resolves.toBeUndefined();
      expect(warnMock).toHaveBeenCalledWith(
        { key: 'service_a.archive.events.processed', value: 42, error: 'connection lost' },
        'Failed to record metric',
      );
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- metrics.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `metrics.service.ts`**

`back-end/service-a/src/infra/redis/metrics.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Redis } from 'ioredis';

import redisConfig, { type RedisConfiguration } from '../../config/redis.config.js';
import { REDIS_CLIENT } from '../infra-clients.tokens.js';

const AUTOMATIC_TIMESTAMP = '*';
const FAILED_METRIC_LOG_MESSAGE = 'Failed to record metric';

@Injectable()
export class MetricsService {
  public constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    @Inject(redisConfig.KEY) private readonly redisConfiguration: RedisConfiguration,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger('MetricsService');
  }

  public async recordMetric(key: string, value: number): Promise<void> {
    try {
      await this.client.call(
        'TS.ADD',
        key,
        AUTOMATIC_TIMESTAMP,
        value,
        'RETENTION',
        this.redisConfiguration.metricsRetentionMs,
      );
    } catch (error) {
      this.logger.warn(
        { key, value, error: error instanceof Error ? error.message : String(error) },
        FAILED_METRIC_LOG_MESSAGE,
      );
    }
  }

  private readonly logger: AppLogger;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- metrics.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Register `MetricsService` on the existing global `RedisModule`**

Modify `back-end/service-a/src/infra/redis/redis.module.ts` to:
```ts
import { Global, Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { LoggerModule } from '@task1/shared/logger/rmq/logger.module';
import { Redis } from 'ioredis';

import redisConfig from '../../config/redis.config.js';
import { REDIS_CLIENT } from '../infra-clients.tokens.js';

import { MetricsService } from './metrics.service.js';
import { RedisConnectionService } from './redis-connection.service.js';

@Global()
@Module({
  imports: [LoggerModule],
  providers: [
    RedisConnectionService,
    MetricsService,
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
  exports: [REDIS_CLIENT, MetricsService],
})
export class RedisModule {}
```

(Only the `providers`/`exports` arrays and the `MetricsService` import changed — the `REDIS_CLIENT`
factory itself is untouched.)

- [ ] **Step 6: Run the full `service-a` test suite and lint**

Run: `pnpm --filter service-a test && pnpm --filter service-a lint`
Expected: both PASS.

- [ ] **Step 7: Stage the files**

```bash
git add back-end/service-a/src/infra/redis/metrics.service.ts back-end/service-a/src/infra/redis/metrics.service.spec.ts back-end/service-a/src/infra/redis/redis.module.ts
```

---

## Task 4: `service-a` — `imports` collection: types, provider, and index

**Files:**
- Create: `back-end/service-a/src/archive/import-run.types.ts`
- Create: `back-end/service-a/src/archive/imports-collection.provider.ts`
- Create: `back-end/service-a/src/archive/imports-collection.provider.spec.ts`
- Create: `back-end/service-a/src/archive/ensure-import-indexes.ts`
- Create: `back-end/service-a/src/archive/ensure-import-indexes.spec.ts`

**Interfaces:**
- Consumes: `MONGO_CLIENT` (Phase 0), `type ImportResult` (Phase 2, `processing/process-archive.ts`).
- Produces: `ImportSourceRecord` (`{ type: 'download'; archive: string } | { type: 'upload'; filename:
  string }`), `ImportRunStatus` (`'started' | 'completed' | 'failed'`), `IImportRunDocument` (the
  `imports` collection's document shape — service-a-internal, deliberately **not** exported from
  `@task1/shared`: this collection is never read by another service, so it stays inside service-a's
  persistence boundary per `CLAUDE.md`'s module-boundary rule). `IMPORTS_COLLECTION` DI token,
  `createImportsCollection(client): Collection<IImportRunDocument>`. `ensureImportIndexes(collection):
  Promise<void>` — idempotently creates the `{ importId: 1 }` unique index (this is what makes the
  `Idempotency-Key` replay check in Task 10 actually enforceable at the database level, not just in
  application code).
- Consumed by: Task 5 (index initializer), Task 6 (`ImportRunTracker`).

- [ ] **Step 1: Add the import-run types (no test — pure interfaces/type aliases, no runtime logic,
  matching this repo's existing `*.types.ts`/contract-file convention)**

`back-end/service-a/src/archive/import-run.types.ts`:
```ts
export type ImportSourceRecord =
  | { readonly type: 'download'; readonly archive: string }
  | { readonly type: 'upload'; readonly filename: string };

export type ImportRunStatus = 'started' | 'completed' | 'failed';

export interface IImportRunDocument {
  importId: string;
  source: ImportSourceRecord;
  status: ImportRunStatus;
  startedAt: Date;
  completedAt?: Date;
  failedAt?: Date;
  eventsProcessed?: number;
  validEvents?: number;
  invalidEvents?: number;
  duplicateEvents?: number;
  errorCount?: number;
  errorSamples?: string[];
}
```

- [ ] **Step 2: Write the failing test for `createImportsCollection`**

`back-end/service-a/src/archive/imports-collection.provider.spec.ts`:
```ts
import { type MongoClient } from 'mongodb';

import { createImportsCollection } from './imports-collection.provider.js';

describe('createImportsCollection', () => {
  it('should return the imports collection from the client default database, when called', () => {
    const collection = { collectionName: 'imports' };
    const collectionFunction = vi.fn().mockReturnValue(collection);
    const db = vi.fn().mockReturnValue({ collection: collectionFunction });
    const client = { db } as unknown as MongoClient;

    const result = createImportsCollection(client);

    expect(result).toBe(collection);
    expect(collectionFunction).toHaveBeenCalledWith('imports');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- imports-collection.provider.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `imports-collection.provider.ts`**

`back-end/service-a/src/archive/imports-collection.provider.ts`:
```ts
import { type Collection, type MongoClient } from 'mongodb';

import { MONGO_CLIENT } from '../infra/infra-clients.tokens.js';

import { type IImportRunDocument } from './import-run.types.js';

export const IMPORTS_COLLECTION = 'IMPORTS_COLLECTION';

const IMPORTS_COLLECTION_NAME = 'imports';

export function createImportsCollection(client: MongoClient): Collection<IImportRunDocument> {
  return client.db().collection<IImportRunDocument>(IMPORTS_COLLECTION_NAME);
}

export const importsCollectionProvider = {
  provide: IMPORTS_COLLECTION,
  inject: [MONGO_CLIENT],
  useFactory: createImportsCollection,
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- imports-collection.provider.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Write the failing test for `ensureImportIndexes`**

`back-end/service-a/src/archive/ensure-import-indexes.spec.ts`:
```ts
import { type Collection } from 'mongodb';

import { ensureImportIndexes } from './ensure-import-indexes.js';
import { type IImportRunDocument } from './import-run.types.js';

describe('ensureImportIndexes', () => {
  it('should create a unique index on importId, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('importId_1');
    const collection = { createIndex } as unknown as Collection<IImportRunDocument>;

    await ensureImportIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ importId: 1 }, { unique: true });
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- ensure-import-indexes.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 8: Implement `ensure-import-indexes.ts`**

`back-end/service-a/src/archive/ensure-import-indexes.ts`:
```ts
import { type Collection } from 'mongodb';

import { type IImportRunDocument } from './import-run.types.js';

export async function ensureImportIndexes(collection: Collection<IImportRunDocument>): Promise<void> {
  await collection.createIndex({ importId: 1 }, { unique: true });
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- ensure-import-indexes.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 10: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 11: Stage the files**

```bash
git add back-end/service-a/src/archive/import-run.types.ts back-end/service-a/src/archive/imports-collection.provider.ts back-end/service-a/src/archive/imports-collection.provider.spec.ts back-end/service-a/src/archive/ensure-import-indexes.ts back-end/service-a/src/archive/ensure-import-indexes.spec.ts
```

---

## Task 5: `service-a` — `EnsureImportIndexesInitializer`

**Files:**
- Create: `back-end/service-a/src/archive/ensure-import-indexes-initializer.service.ts`
- Create: `back-end/service-a/src/archive/ensure-import-indexes-initializer.service.spec.ts`

**Interfaces:**
- Consumes: `IMPORTS_COLLECTION` (Task 4), `ensureImportIndexes` (Task 4), `LoggerService`.
- Produces: `EnsureImportIndexesInitializer implements OnModuleInit` — runs once at boot, mirrors the
  existing `EnsureEventIndexesInitializer` exactly.
- Consumed by: Task 11 (`ArchiveModule` providers).

- [ ] **Step 1: Write the failing tests**

`back-end/service-a/src/archive/ensure-import-indexes-initializer.service.spec.ts`:
```ts
import { type LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Collection } from 'mongodb';

import { EnsureImportIndexesInitializer } from './ensure-import-indexes-initializer.service.js';
import { type IImportRunDocument } from './import-run.types.js';

describe('EnsureImportIndexesInitializer', () => {
  it('should create the unique importId index and log success, when the module initializes', async () => {
    const createIndex = vi.fn().mockResolvedValue('importId_1');
    const collection = { createIndex } as unknown as Collection<IImportRunDocument>;
    const infoMock = vi.fn();
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ info: infoMock }),
    } as unknown as LoggerService;
    const initializer = new EnsureImportIndexesInitializer(collection, loggerService);

    await initializer.onModuleInit();

    expect(createIndex).toHaveBeenCalledWith({ importId: 1 }, { unique: true });
    expect(infoMock).toHaveBeenCalledWith({}, 'Ensured imports collection indexes');
  });

  it('should propagate the error, when index creation fails', async () => {
    const createIndex = vi.fn().mockRejectedValue(new Error('connection refused'));
    const collection = { createIndex } as unknown as Collection<IImportRunDocument>;
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ info: vi.fn() }),
    } as unknown as LoggerService;
    const initializer = new EnsureImportIndexesInitializer(collection, loggerService);

    await expect(initializer.onModuleInit()).rejects.toThrow('connection refused');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- ensure-import-indexes-initializer.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ensure-import-indexes-initializer.service.ts`**

`back-end/service-a/src/archive/ensure-import-indexes-initializer.service.ts`:
```ts
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Collection } from 'mongodb';

import { ensureImportIndexes } from './ensure-import-indexes.js';
import { IMPORTS_COLLECTION } from './imports-collection.provider.js';
import { type IImportRunDocument } from './import-run.types.js';

@Injectable()
export class EnsureImportIndexesInitializer implements OnModuleInit {
  public constructor(
    @Inject(IMPORTS_COLLECTION) private readonly collection: Collection<IImportRunDocument>,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger('EnsureImportIndexesInitializer');
  }

  public async onModuleInit(): Promise<void> {
    await ensureImportIndexes(this.collection);

    this.logger.info({}, 'Ensured imports collection indexes');
  }

  private readonly logger: AppLogger;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- ensure-import-indexes-initializer.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/archive/ensure-import-indexes-initializer.service.ts back-end/service-a/src/archive/ensure-import-indexes-initializer.service.spec.ts
```

---

## Task 6: `service-a` — `ImportRunTracker`

**Files:**
- Create: `back-end/service-a/src/archive/import-run-tracker.service.ts`
- Create: `back-end/service-a/src/archive/import-run-tracker.service.spec.ts`

**Interfaces:**
- Consumes: `IMPORTS_COLLECTION` (Task 4), `type ImportResult` (Phase 2), `type ImportSourceRecord`/
  `IImportRunDocument` (Task 4).
- Produces: `ImportRunTracker.findByImportId(importId): Promise<IImportRunDocument | null>`,
  `.recordStarted(importId, source, startedAt): Promise<void>`, `.recordCompleted(importId, result,
  completedAt): Promise<void>`, `.recordFailed(importId, reason, failedAt): Promise<void>` (appends a
  200-character-truncated `reason` sample, keeping only the most recent 5 via `$slice`).
- Consumed by: Task 9 (`ImportOrchestrationService`'s dependency bag), Task 10
  (`DownloadImportController`'s idempotency check).

- [ ] **Step 1: Write the failing tests**

`back-end/service-a/src/archive/import-run-tracker.service.spec.ts`:
```ts
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection } from 'mongodb';

import { type ImportResult } from './processing/process-archive.js';
import { ImportRunTracker } from './import-run-tracker.service.js';
import { type IImportRunDocument } from './import-run.types.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- keeps IGithubEventDocument's import path exercised for consistency with the rest of this module's test files; no direct use here.
type _Unused = IGithubEventDocument;

describe('ImportRunTracker', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  function buildTracker(
    findOne: ReturnType<typeof vi.fn>,
    insertOne: ReturnType<typeof vi.fn>,
    updateOne: ReturnType<typeof vi.fn>,
  ): ImportRunTracker {
    const collection = { findOne, insertOne, updateOne } as unknown as Collection<IImportRunDocument>;

    return new ImportRunTracker(collection);
  }

  describe('findByImportId', () => {
    it('should return the matching document, when one exists', async () => {
      const document: IImportRunDocument = {
        importId,
        source: { type: 'download', archive: '2026-08-11-0.json.gz' },
        status: 'started',
        startedAt: new Date('2026-08-11T00:00:00Z'),
      };
      const findOne = vi.fn().mockResolvedValue(document);
      const tracker = buildTracker(findOne, vi.fn(), vi.fn());

      const result = await tracker.findByImportId(importId);

      expect(result).toBe(document);
      expect(findOne).toHaveBeenCalledWith({ importId });
    });

    it('should return null, when no document matches', async () => {
      const findOne = vi.fn().mockResolvedValue(null);
      const tracker = buildTracker(findOne, vi.fn(), vi.fn());

      await expect(tracker.findByImportId(importId)).resolves.toBeNull();
    });
  });

  describe('recordStarted', () => {
    it('should insert a started document with the given source and startedAt, when called', async () => {
      const insertOne = vi.fn().mockResolvedValue({ acknowledged: true });
      const tracker = buildTracker(vi.fn(), insertOne, vi.fn());
      const startedAt = new Date('2026-08-11T00:00:00Z');
      const source = { type: 'download' as const, archive: '2026-08-11-0.json.gz' };

      await tracker.recordStarted(importId, source, startedAt);

      expect(insertOne).toHaveBeenCalledWith({ importId, source, status: 'started', startedAt });
    });
  });

  describe('recordCompleted', () => {
    it('should set completed status, completedAt, and every result counter, when called', async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const tracker = buildTracker(vi.fn(), vi.fn(), updateOne);
      const completedAt = new Date('2026-08-11T00:05:00Z');
      const result: ImportResult = {
        eventsProcessed: 10,
        validEvents: 8,
        invalidEvents: 1,
        duplicateEvents: 1,
        errorCount: 0,
      };

      await tracker.recordCompleted(importId, result, completedAt);

      expect(updateOne).toHaveBeenCalledWith(
        { importId },
        { $set: { status: 'completed', completedAt, ...result } },
      );
    });
  });

  describe('recordFailed', () => {
    it('should set failed status and failedAt and push a truncated error sample, when called', async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const tracker = buildTracker(vi.fn(), vi.fn(), updateOne);
      const failedAt = new Date('2026-08-11T00:02:00Z');

      await tracker.recordFailed(importId, 'download failed: 404 Not Found', failedAt);

      expect(updateOne).toHaveBeenCalledWith(
        { importId },
        {
          $set: { status: 'failed', failedAt },
          $push: { errorSamples: { $each: ['download failed: 404 Not Found'], $slice: -5 } },
        },
      );
    });

    it('should truncate the stored reason to 500 characters, when the reason is longer', async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const tracker = buildTracker(vi.fn(), vi.fn(), updateOne);
      const failedAt = new Date('2026-08-11T00:02:00Z');
      const longReason = 'x'.repeat(600);

      await tracker.recordFailed(importId, longReason, failedAt);

      expect(updateOne).toHaveBeenCalledWith(
        { importId },
        {
          $set: { status: 'failed', failedAt },
          $push: { errorSamples: { $each: [longReason.slice(0, 500)], $slice: -5 } },
        },
      );
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- import-run-tracker.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `import-run-tracker.service.ts`**

`back-end/service-a/src/archive/import-run-tracker.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { type Collection } from 'mongodb';

import { type ImportResult } from './processing/process-archive.js';
import { IMPORTS_COLLECTION } from './imports-collection.provider.js';
import { type IImportRunDocument, type ImportSourceRecord } from './import-run.types.js';

const ERROR_SAMPLE_MAX_LENGTH = 500;
const ERROR_SAMPLES_LIMIT = 5;

@Injectable()
export class ImportRunTracker {
  public constructor(
    @Inject(IMPORTS_COLLECTION) private readonly collection: Collection<IImportRunDocument>,
  ) {}

  public async findByImportId(importId: string): Promise<IImportRunDocument | null> {
    return this.collection.findOne({ importId });
  }

  public async recordStarted(
    importId: string,
    source: ImportSourceRecord,
    startedAt: Date,
  ): Promise<void> {
    await this.collection.insertOne({ importId, source, status: 'started', startedAt });
  }

  public async recordCompleted(
    importId: string,
    result: ImportResult,
    completedAt: Date,
  ): Promise<void> {
    await this.collection.updateOne(
      { importId },
      { $set: { status: 'completed', completedAt, ...result } },
    );
  }

  public async recordFailed(importId: string, reason: string, failedAt: Date): Promise<void> {
    await this.collection.updateOne(
      { importId },
      {
        $set: { status: 'failed', failedAt },
        $push: {
          errorSamples: {
            $each: [reason.slice(0, ERROR_SAMPLE_MAX_LENGTH)],
            $slice: -ERROR_SAMPLES_LIMIT,
          },
        },
      },
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- import-run-tracker.service.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/archive/import-run-tracker.service.ts back-end/service-a/src/archive/import-run-tracker.service.spec.ts
```

---

## Task 7: `service-a` — `ArchiveDownloadService`

**Files:**
- Create: `back-end/service-a/src/archive/download/archive-download.service.ts`
- Create: `back-end/service-a/src/archive/download/archive-download.service.spec.ts`

**Interfaces:**
- Consumes: `downloadArchive`/`type HttpGetFunction` (Phase 1), `archiveConfig` (Phase 1), `storageConfig`
  (Phase 0).
- Produces: `ArchiveDownloadService.download(dateHour: string, httpGet?: HttpGetFunction):
  Promise<IDownloadArchiveResult>` — a thin DI wrapper around Phase 1's pure `downloadArchive`, exactly
  mirroring how Phase 3's existing `ArchiveProcessingService` wraps Phase 2's `processArchive`. The
  optional `httpGet` parameter is **not** wired through DI — it exists purely as this service's own test
  seam (this service's test passes a fake; every real caller omits it, so `downloadArchive` falls back to
  its own real `node:https`-based default).
- Consumed by: Task 9 (`ImportOrchestrationService`'s dependency bag).

- [ ] **Step 1: Write the failing tests**

`back-end/service-a/src/archive/download/archive-download.service.spec.ts`:
```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { type ClientRequest, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { type ArchiveConfiguration } from '../../config/archive.config.js';
import { type StorageConfiguration } from '../../config/storage.config.js';

import { ArchiveDownloadService } from './archive-download.service.js';
import { type HttpGetFunction } from './fetch-archive-stream.js';

describe('ArchiveDownloadService', () => {
  let storageDirectory: string;

  beforeEach(() => {
    storageDirectory = mkdtempSync(join(tmpdir(), 'archive-download-service-spec-'));
  });

  afterEach(() => {
    rmSync(storageDirectory, { recursive: true, force: true });
  });

  function buildService(): ArchiveDownloadService {
    const archiveConfiguration: ArchiveConfiguration = {
      baseUrl: 'https://data.gharchive.org',
      downloadTimeoutMs: 1000,
    };
    const storageConfiguration: StorageConfiguration = { dir: storageDirectory };

    return new ArchiveDownloadService(archiveConfiguration, storageConfiguration);
  }

  const buildSuccessfulHttpGet = (content: string): HttpGetFunction => {
    const fakeRequest = { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };

    return vi.fn((_url: string, callback: (response: IncomingMessage) => void) => {
      const response = Readable.from([content]) as unknown as IncomingMessage;
      response.statusCode = 200;

      callback(response);

      return fakeRequest as unknown as ClientRequest;
    });
  };

  it('should download using the injected config and return the final file path, when given a valid dateHour', async () => {
    const httpGet = buildSuccessfulHttpGet('fake gzip content');
    const service = buildService();

    const result = await service.download('2026-08-11-0', httpGet);

    expect(result.filePath).toBe(join(storageDirectory, '2026-08-11-0.json.gz'));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- archive-download.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `archive-download.service.ts`**

`back-end/service-a/src/archive/download/archive-download.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';

import archiveConfig, { type ArchiveConfiguration } from '../../config/archive.config.js';
import storageConfig, { type StorageConfiguration } from '../../config/storage.config.js';

import { downloadArchive, type IDownloadArchiveResult } from './download-archive.js';
import { type HttpGetFunction } from './fetch-archive-stream.js';

@Injectable()
export class ArchiveDownloadService {
  public constructor(
    @Inject(archiveConfig.KEY) private readonly archiveConfiguration: ArchiveConfiguration,
    @Inject(storageConfig.KEY) private readonly storageConfiguration: StorageConfiguration,
  ) {}

  public download(dateHour: string, httpGet?: HttpGetFunction): Promise<IDownloadArchiveResult> {
    return downloadArchive(
      dateHour,
      {
        baseUrl: this.archiveConfiguration.baseUrl,
        storageDirectory: this.storageConfiguration.dir,
        timeoutMs: this.archiveConfiguration.downloadTimeoutMs,
      },
      httpGet,
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- archive-download.service.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/archive/download/archive-download.service.ts back-end/service-a/src/archive/download/archive-download.service.spec.ts
```

---

## Task 8: `service-a` — outbound `SERVICE_B_RMQ_CLIENT` and `import-archive.ts`

**Files:**
- Create: `back-end/service-a/src/archive/rabbitmq-client.token.ts`
- Create: `back-end/service-a/src/archive/import-archive.ts`
- Create: `back-end/service-a/src/archive/import-archive.spec.ts`

**Interfaces:**
- Consumes: `EVENT_PATTERNS`, `type ImportStartedEvent`/`ImportCompletedEvent`/`ImportFailedEvent`
  (Phase 0, `@task1/shared/github-archive/index`), `type ImportResult` (Phase 2), `type
  ImportSourceRecord` (Task 4).
- Produces: `SERVICE_B_RMQ_CLIENT` token (string constant). `type ImportSourceInput = { type:
  'download'; dateHour: string } | { type: 'upload'; filePath: string }`. `IImportArchiveDependencies`
  (a plain-function dependency bag: `downloadArchive`, `processArchive`, `emitEvent`, `recordMetric`,
  `recordImportStarted`, `recordImportCompleted`, `recordImportFailed`). `importArchive(source:
  ImportSourceInput, importId: string, correlationId: string, dependencies:
  IImportArchiveDependencies): Promise<ImportResult>` — the pure orchestration function per the design
  doc's pseudocode, extended with metric recording and `imports`-collection tracking.
- Consumed by: Task 9 (`ImportOrchestrationService`), Task 11 (`ArchiveModule`'s `ClientsModule` wiring).

- [ ] **Step 1: Add the DI token (no test — plain string constant, matching the gateway's existing
  `rabbitmq-client.token.ts`)**

`back-end/service-a/src/archive/rabbitmq-client.token.ts`:
```ts
export const SERVICE_B_RMQ_CLIENT = 'SERVICE_B_RMQ_CLIENT';
```

- [ ] **Step 2: Write the failing tests**

`back-end/service-a/src/archive/import-archive.spec.ts`:
```ts
import { EVENT_PATTERNS } from '@task1/shared/github-archive/index';

import { importArchive, type IImportArchiveDependencies } from './import-archive.js';
import { type ImportResult } from './processing/process-archive.js';

describe('importArchive', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const correlationId = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const successfulResult: ImportResult = {
    eventsProcessed: 10,
    validEvents: 8,
    invalidEvents: 1,
    duplicateEvents: 1,
    errorCount: 0,
  };

  function buildDependencies(
    overrides: Partial<IImportArchiveDependencies> = {},
  ): IImportArchiveDependencies & Record<keyof IImportArchiveDependencies, ReturnType<typeof vi.fn>> {
    return {
      downloadArchive: vi.fn().mockResolvedValue({ filePath: '/data/archives/2026-08-11-0.json.gz' }),
      processArchive: vi.fn().mockResolvedValue(successfulResult),
      emitEvent: vi.fn(),
      recordMetric: vi.fn().mockResolvedValue(undefined),
      recordImportStarted: vi.fn().mockResolvedValue(undefined),
      recordImportCompleted: vi.fn().mockResolvedValue(undefined),
      recordImportFailed: vi.fn().mockResolvedValue(undefined),
      ...overrides,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- fully mocked dependency bag; each field is itself a vi.fn() so the cast below is sound.
    } as unknown as IImportArchiveDependencies & Record<keyof IImportArchiveDependencies, ReturnType<typeof vi.fn>>;
  }

  describe('download source, success', () => {
    it('should emit started then completed, download and process the archive, and record download/processing metrics, when the download and processing both succeed', async () => {
      const dependencies = buildDependencies();

      const result = await importArchive(
        { type: 'download', dateHour: '2026-08-11-0' },
        importId,
        correlationId,
        dependencies,
      );

      expect(result).toEqual(successfulResult);
      expect(dependencies.downloadArchive).toHaveBeenCalledWith('2026-08-11-0');
      expect(dependencies.processArchive).toHaveBeenCalledWith(
        '/data/archives/2026-08-11-0.json.gz',
        importId,
      );

      const emittedPatterns = dependencies.emitEvent.mock.calls.map(([pattern]) => pattern);

      expect(emittedPatterns).toEqual([EVENT_PATTERNS.IMPORT_STARTED, EVENT_PATTERNS.IMPORT_COMPLETED]);

      const [, startedPayload] = dependencies.emitEvent.mock.calls[0] as [string, { archive: string }];
      const [, completedPayload] = dependencies.emitEvent.mock.calls[1] as [
        string,
        { archive: string; eventsProcessed: number },
      ];

      expect(startedPayload.archive).toBe('2026-08-11-0.json.gz');
      expect(completedPayload.archive).toBe('2026-08-11-0.json.gz');
      expect(completedPayload.eventsProcessed).toBe(successfulResult.eventsProcessed);

      const recordedMetricKeys = dependencies.recordMetric.mock.calls.map(([key]) => key);

      expect(recordedMetricKeys).toEqual([
        'service_a.archive.download.duration',
        'service_a.archive.processing.duration',
        'service_a.archive.events.processed',
        'service_a.archive.events.invalid',
      ]);
      expect(dependencies.recordImportStarted).toHaveBeenCalledWith(
        importId,
        { type: 'download', archive: '2026-08-11-0.json.gz' },
        expect.any(Date),
      );
      expect(dependencies.recordImportCompleted).toHaveBeenCalledWith(
        importId,
        successfulResult,
        expect.any(Date),
      );
    });

    it('should record a processing-errors metric, when the result has a nonzero errorCount', async () => {
      const resultWithErrors: ImportResult = { ...successfulResult, errorCount: 3 };
      const dependencies = buildDependencies({
        processArchive: vi.fn().mockResolvedValue(resultWithErrors),
      });

      await importArchive(
        { type: 'download', dateHour: '2026-08-11-0' },
        importId,
        correlationId,
        dependencies,
      );

      const recordedMetricKeys = dependencies.recordMetric.mock.calls.map(([key]) => key);

      expect(recordedMetricKeys).toContain('service_a.archive.processing.errors');
    });
  });

  describe('upload source, success', () => {
    it('should skip the download step and its duration metric, when the source is an upload', async () => {
      const dependencies = buildDependencies();

      await importArchive(
        { type: 'upload', filePath: '/data/archives/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.json.gz' },
        importId,
        correlationId,
        dependencies,
      );

      expect(dependencies.downloadArchive).not.toHaveBeenCalled();
      expect(dependencies.processArchive).toHaveBeenCalledWith(
        '/data/archives/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.json.gz',
        importId,
      );

      const recordedMetricKeys = dependencies.recordMetric.mock.calls.map(([key]) => key);

      expect(recordedMetricKeys).not.toContain('service_a.archive.download.duration');
      expect(dependencies.recordImportStarted).toHaveBeenCalledWith(
        importId,
        { type: 'upload', filename: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.json.gz' },
        expect.any(Date),
      );
    });
  });

  describe('failure', () => {
    it('should emit started then failed and record the import as failed, when downloadArchive rejects', async () => {
      const downloadError = new Error('archive download failed with HTTP 404');
      const dependencies = buildDependencies({
        downloadArchive: vi.fn().mockRejectedValue(downloadError),
      });

      await expect(
        importArchive({ type: 'download', dateHour: '2026-08-11-0' }, importId, correlationId, dependencies),
      ).rejects.toThrow(downloadError);

      const emittedPatterns = dependencies.emitEvent.mock.calls.map(([pattern]) => pattern);

      expect(emittedPatterns).toEqual([EVENT_PATTERNS.IMPORT_STARTED, EVENT_PATTERNS.IMPORT_FAILED]);
      expect(dependencies.processArchive).not.toHaveBeenCalled();
      expect(dependencies.recordImportFailed).toHaveBeenCalledWith(
        importId,
        downloadError.message,
        expect.any(Date),
      );
    });

    it('should emit started then failed and rethrow, when processArchive rejects', async () => {
      const processingError = new Error('archive processing failed');
      const dependencies = buildDependencies({
        processArchive: vi.fn().mockRejectedValue(processingError),
      });

      await expect(
        importArchive({ type: 'upload', filePath: '/data/archives/x.json.gz' }, importId, correlationId, dependencies),
      ).rejects.toThrow(processingError);

      const emittedPatterns = dependencies.emitEvent.mock.calls.map(([pattern]) => pattern);

      expect(emittedPatterns).toEqual([EVENT_PATTERNS.IMPORT_STARTED, EVENT_PATTERNS.IMPORT_FAILED]);
      expect(dependencies.recordImportCompleted).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- import-archive.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `import-archive.ts`**

`back-end/service-a/src/archive/import-archive.ts`:
```ts
import { basename } from 'node:path';

import {
  EVENT_PATTERNS,
  type ImportCompletedEvent,
  type ImportFailedEvent,
  type ImportStartedEvent,
} from '@task1/shared/github-archive/index';

import { type ImportResult } from './processing/process-archive.js';
import { type ImportSourceRecord } from './import-run.types.js';

const METRIC_DOWNLOAD_DURATION = 'service_a.archive.download.duration';
const METRIC_PROCESSING_DURATION = 'service_a.archive.processing.duration';
const METRIC_EVENTS_PROCESSED = 'service_a.archive.events.processed';
const METRIC_EVENTS_INVALID = 'service_a.archive.events.invalid';
const METRIC_PROCESSING_ERRORS = 'service_a.archive.processing.errors';

export type ImportSourceInput =
  | { readonly type: 'download'; readonly dateHour: string }
  | { readonly type: 'upload'; readonly filePath: string };

export interface IImportArchiveDependencies {
  downloadArchive: (dateHour: string) => Promise<{ filePath: string }>;
  processArchive: (filePath: string, importId: string) => Promise<ImportResult>;
  emitEvent: (pattern: string, payload: unknown) => void;
  recordMetric: (key: string, value: number) => Promise<void>;
  recordImportStarted: (
    importId: string,
    source: ImportSourceRecord,
    startedAt: Date,
  ) => Promise<void>;
  recordImportCompleted: (importId: string, result: ImportResult, completedAt: Date) => Promise<void>;
  recordImportFailed: (importId: string, reason: string, failedAt: Date) => Promise<void>;
}

export async function importArchive(
  source: ImportSourceInput,
  importId: string,
  correlationId: string,
  dependencies: IImportArchiveDependencies,
): Promise<ImportResult> {
  const startedAt = new Date();
  const archiveLabel = source.type === 'download' ? `${source.dateHour}.json.gz` : basename(source.filePath);
  const sourceRecord: ImportSourceRecord =
    source.type === 'download'
      ? { type: 'download', archive: archiveLabel }
      : { type: 'upload', filename: archiveLabel };

  const startedEvent: ImportStartedEvent = {
    importId,
    archive: archiveLabel,
    startedAt: startedAt.toISOString(),
    correlationId,
  };

  dependencies.emitEvent(EVENT_PATTERNS.IMPORT_STARTED, startedEvent);
  await dependencies.recordImportStarted(importId, sourceRecord, startedAt);

  try {
    let filePath: string;

    if (source.type === 'download') {
      const downloadStartedAt = Date.now();
      const downloadResult = await dependencies.downloadArchive(source.dateHour);

      filePath = downloadResult.filePath;

      await dependencies.recordMetric(METRIC_DOWNLOAD_DURATION, Date.now() - downloadStartedAt);
    } else {
      filePath = source.filePath;
    }

    const processingStartedAt = Date.now();
    const result = await dependencies.processArchive(filePath, importId);

    await dependencies.recordMetric(METRIC_PROCESSING_DURATION, Date.now() - processingStartedAt);
    await dependencies.recordMetric(METRIC_EVENTS_PROCESSED, result.eventsProcessed);
    await dependencies.recordMetric(METRIC_EVENTS_INVALID, result.invalidEvents);

    if (result.errorCount > 0) {
      await dependencies.recordMetric(METRIC_PROCESSING_ERRORS, result.errorCount);
    }

    const completedAt = new Date();
    const completedEvent: ImportCompletedEvent = {
      importId,
      archive: archiveLabel,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      eventsProcessed: result.eventsProcessed,
      validEvents: result.validEvents,
      invalidEvents: result.invalidEvents,
      duplicateEvents: result.duplicateEvents,
      errorCount: result.errorCount,
      correlationId,
    };

    dependencies.emitEvent(EVENT_PATTERNS.IMPORT_COMPLETED, completedEvent);
    await dependencies.recordImportCompleted(importId, result, completedAt);

    return result;
  } catch (error) {
    const failedAt = new Date();
    const reason = error instanceof Error ? error.message : String(error);
    const failedEvent: ImportFailedEvent = {
      importId,
      archive: archiveLabel,
      startedAt: startedAt.toISOString(),
      failedAt: failedAt.toISOString(),
      reason,
      correlationId,
    };

    dependencies.emitEvent(EVENT_PATTERNS.IMPORT_FAILED, failedEvent);
    await dependencies.recordImportFailed(importId, reason, failedAt);

    throw error;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- import-archive.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 7: Stage the files**

```bash
git add back-end/service-a/src/archive/rabbitmq-client.token.ts back-end/service-a/src/archive/import-archive.ts back-end/service-a/src/archive/import-archive.spec.ts
```

---

## Task 9: `service-a` — `ImportOrchestrationService`

**Files:**
- Create: `back-end/service-a/src/archive/import-orchestration.service.ts`
- Create: `back-end/service-a/src/archive/import-orchestration.service.spec.ts`

**Interfaces:**
- Consumes: `SERVICE_B_RMQ_CLIENT` (Task 8), `MetricsService` (Task 3), `ImportRunTracker` (Task 6),
  `ArchiveDownloadService` (Task 7), `ArchiveProcessingService` (Phase 3, existing), `importArchive`
  (Task 8).
- Produces: `ImportOrchestrationService.importDownload(dateHour, importId, correlationId):
  Promise<ImportResult>`, `.importUpload(filePath, importId, correlationId): Promise<ImportResult>`.
- Consumed by: Task 10 (`DownloadImportController`), Task 11 (modified `UploadImportController`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-a/src/archive/import-orchestration.service.spec.ts`:
```ts
import { type ClientProxy } from '@nestjs/microservices';

import { type ArchiveDownloadService } from './download/archive-download.service.js';
import { type ArchiveProcessingService } from './upload/archive-processing.service.js';
import { ImportOrchestrationService } from './import-orchestration.service.js';
import { type ImportRunTracker } from './import-run-tracker.service.js';
import { type MetricsService } from '../infra/redis/metrics.service.js';
import { type ImportResult } from './processing/process-archive.js';

describe('ImportOrchestrationService', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const correlationId = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const successfulResult: ImportResult = {
    eventsProcessed: 3,
    validEvents: 3,
    invalidEvents: 0,
    duplicateEvents: 0,
    errorCount: 0,
  };

  function buildService(): {
    service: ImportOrchestrationService;
    emit: ReturnType<typeof vi.fn>;
    download: ReturnType<typeof vi.fn>;
    process: ReturnType<typeof vi.fn>;
    recordMetric: ReturnType<typeof vi.fn>;
    recordImportStarted: ReturnType<typeof vi.fn>;
    recordImportCompleted: ReturnType<typeof vi.fn>;
  } {
    const emit = vi.fn();
    const download = vi.fn().mockResolvedValue({ filePath: '/data/archives/2026-08-11-0.json.gz' });
    const process = vi.fn().mockResolvedValue(successfulResult);
    const recordMetric = vi.fn().mockResolvedValue(undefined);
    const recordImportStarted = vi.fn().mockResolvedValue(undefined);
    const recordImportCompleted = vi.fn().mockResolvedValue(undefined);
    const recordImportFailed = vi.fn().mockResolvedValue(undefined);

    const serviceBClient = { emit } as unknown as ClientProxy;
    const metricsService = { recordMetric } as unknown as MetricsService;
    const importRunTracker = {
      recordStarted: recordImportStarted,
      recordCompleted: recordImportCompleted,
      recordFailed: recordImportFailed,
    } as unknown as ImportRunTracker;
    const archiveDownloadService = { download } as unknown as ArchiveDownloadService;
    const archiveProcessingService = { process } as unknown as ArchiveProcessingService;

    const service = new ImportOrchestrationService(
      serviceBClient,
      metricsService,
      importRunTracker,
      archiveDownloadService,
      archiveProcessingService,
    );

    return { service, emit, download, process, recordMetric, recordImportStarted, recordImportCompleted };
  }

  describe('importDownload', () => {
    it('should download, process, and emit the full lifecycle over the outbound client, when the download succeeds', async () => {
      const { service, emit, download, process } = buildService();

      const result = await service.importDownload('2026-08-11-0', importId, correlationId);

      expect(result).toEqual(successfulResult);
      expect(download).toHaveBeenCalledWith('2026-08-11-0');
      expect(process).toHaveBeenCalledWith('/data/archives/2026-08-11-0.json.gz', importId);
      expect(emit).toHaveBeenCalledTimes(2);
      expect(emit.mock.calls[0]?.[0]).toBe('github.import.started');
      expect(emit.mock.calls[1]?.[0]).toBe('github.import.completed');
    });
  });

  describe('importUpload', () => {
    it('should process the given file path directly without downloading, when called', async () => {
      const { service, download, process } = buildService();

      const result = await service.importUpload(
        '/data/archives/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.json.gz',
        importId,
        correlationId,
      );

      expect(result).toEqual(successfulResult);
      expect(download).not.toHaveBeenCalled();
      expect(process).toHaveBeenCalledWith(
        '/data/archives/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.json.gz',
        importId,
      );
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- import-orchestration.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `import-orchestration.service.ts`**

`back-end/service-a/src/archive/import-orchestration.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { type ClientProxy } from '@nestjs/microservices';

import { MetricsService } from '../infra/redis/metrics.service.js';

import { ArchiveDownloadService } from './download/archive-download.service.js';
import { ArchiveProcessingService } from './upload/archive-processing.service.js';
import { importArchive, type IImportArchiveDependencies } from './import-archive.js';
import { ImportRunTracker } from './import-run-tracker.service.js';
import { type ImportResult } from './processing/process-archive.js';
import { SERVICE_B_RMQ_CLIENT } from './rabbitmq-client.token.js';

@Injectable()
export class ImportOrchestrationService {
  public constructor(
    @Inject(SERVICE_B_RMQ_CLIENT) private readonly serviceBClient: ClientProxy,
    private readonly metricsService: MetricsService,
    private readonly importRunTracker: ImportRunTracker,
    private readonly archiveDownloadService: ArchiveDownloadService,
    private readonly archiveProcessingService: ArchiveProcessingService,
  ) {}

  public importDownload(dateHour: string, importId: string, correlationId: string): Promise<ImportResult> {
    return importArchive({ type: 'download', dateHour }, importId, correlationId, this.buildDependencies());
  }

  public importUpload(filePath: string, importId: string, correlationId: string): Promise<ImportResult> {
    return importArchive({ type: 'upload', filePath }, importId, correlationId, this.buildDependencies());
  }

  private buildDependencies(): IImportArchiveDependencies {
    return {
      downloadArchive: (dateHour) => this.archiveDownloadService.download(dateHour),
      processArchive: (filePath, importId) => this.archiveProcessingService.process(filePath, importId),
      emitEvent: (pattern, payload) => {
        this.serviceBClient.emit(pattern, payload);
      },
      recordMetric: (key, value) => this.metricsService.recordMetric(key, value),
      recordImportStarted: (importId, source, startedAt) =>
        this.importRunTracker.recordStarted(importId, source, startedAt),
      recordImportCompleted: (importId, result, completedAt) =>
        this.importRunTracker.recordCompleted(importId, result, completedAt),
      recordImportFailed: (importId, reason, failedAt) =>
        this.importRunTracker.recordFailed(importId, reason, failedAt),
    };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- import-orchestration.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/archive/import-orchestration.service.ts back-end/service-a/src/archive/import-orchestration.service.spec.ts
```

---

## Task 10: `service-a` — `DownloadImportController`

**Files:**
- Create: `back-end/service-a/src/archive/download/download-import-message.schema.ts`
- Create: `back-end/service-a/src/archive/download/download-import-message.schema.spec.ts`
- Create: `back-end/service-a/src/archive/download/download-import.controller.ts`
- Create: `back-end/service-a/src/archive/download/download-import.controller.spec.ts`

**Interfaces:**
- Consumes: `ImportOrchestrationService` (Task 9), `ImportRunTracker` (Task 6), `RequestContextService`
  (`@task1/shared`).
- Produces: `downloadImportMessageSchema` (Zod, `{ importId: string; dateHour: string }`),
  `DownloadImportController` — `@EventPattern('archive.import.download')`. This is where the
  `Idempotency-Key` replay check actually lives (per this phase's Finding 3 / scope decision): if
  `importId` already has an `imports` document, the handler is a silent no-op — it never re-emits
  lifecycle events or re-downloads/re-processes.
- Consumed by: Task 11 (`ArchiveModule` controllers), Task 12 (gateway's trigger endpoint sends this
  message pattern).

- [ ] **Step 1: Write the failing tests for the message schema**

`back-end/service-a/src/archive/download/download-import-message.schema.spec.ts`:
```ts
import { downloadImportMessageSchema } from './download-import-message.schema.js';

describe('downloadImportMessageSchema', () => {
  const validMessage = { importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', dateHour: '2026-08-11-0' };

  it('should accept a valid message, when importId is a UUID and dateHour is non-empty', () => {
    expect(downloadImportMessageSchema.parse(validMessage)).toEqual(validMessage);
  });

  it('should throw, when importId is not a UUID', () => {
    expect(() =>
      downloadImportMessageSchema.parse({ ...validMessage, importId: 'not-a-uuid' }),
    ).toThrow();
  });

  it('should throw, when dateHour is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { dateHour, ...withoutDateHour } = validMessage;

    expect(() => downloadImportMessageSchema.parse(withoutDateHour)).toThrow();
  });

  it('should throw, when dateHour is an empty string', () => {
    expect(() => downloadImportMessageSchema.parse({ ...validMessage, dateHour: '' })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- download-import-message.schema.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the message schema**

`back-end/service-a/src/archive/download/download-import-message.schema.ts`:
```ts
import { z } from 'zod';

export const downloadImportMessageSchema = z.object({
  importId: z.uuid(),
  dateHour: z.string().min(1),
});

export type DownloadImportMessage = z.infer<typeof downloadImportMessageSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- download-import-message.schema.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing tests for the controller**

`back-end/service-a/src/archive/download/download-import.controller.spec.ts`:
```ts
import { type LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';

import { type ImportOrchestrationService } from '../import-orchestration.service.js';
import { type ImportRunTracker } from '../import-run-tracker.service.js';
import { type IImportRunDocument } from '../import-run.types.js';

import { DownloadImportController } from './download-import.controller.js';

describe('DownloadImportController', () => {
  const validPayload = { importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', dateHour: '2026-08-11-0' };
  const correlationId = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  function buildController(
    findByImportId: ReturnType<typeof vi.fn>,
    importDownload: ReturnType<typeof vi.fn>,
    requestContextService: RequestContextService,
  ): { controller: DownloadImportController; infoMock: ReturnType<typeof vi.fn> } {
    const importOrchestrationService = { importDownload } as unknown as ImportOrchestrationService;
    const importRunTracker = { findByImportId } as unknown as ImportRunTracker;
    const infoMock = vi.fn();
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ info: infoMock }),
    } as unknown as LoggerService;
    const controller = new DownloadImportController(
      importOrchestrationService,
      importRunTracker,
      requestContextService,
      loggerService,
    );

    return { controller, infoMock };
  }

  it('should call importDownload with the validated dateHour, importId, and correlationId, when no import is recorded yet', async () => {
    const findByImportId = vi.fn().mockResolvedValue(null);
    const importDownload = vi.fn().mockResolvedValue({
      eventsProcessed: 1,
      validEvents: 1,
      invalidEvents: 0,
      duplicateEvents: 0,
      errorCount: 0,
    });
    const requestContextService = new RequestContextService();
    const { controller } = buildController(findByImportId, importDownload, requestContextService);

    await requestContextService.run({ correlationId, requestId: correlationId }, async () => {
      await controller.handleDownload(validPayload);
    });

    expect(findByImportId).toHaveBeenCalledWith(validPayload.importId);
    expect(importDownload).toHaveBeenCalledWith(
      validPayload.dateHour,
      validPayload.importId,
      correlationId,
    );
  });

  it('should skip importDownload and log, when the importId is already recorded', async () => {
    const existing = { importId: validPayload.importId } as unknown as IImportRunDocument;
    const findByImportId = vi.fn().mockResolvedValue(existing);
    const importDownload = vi.fn();
    const requestContextService = new RequestContextService();
    const { controller, infoMock } = buildController(findByImportId, importDownload, requestContextService);

    await requestContextService.run({ correlationId, requestId: correlationId }, async () => {
      await controller.handleDownload(validPayload);
    });

    expect(importDownload).not.toHaveBeenCalled();
    expect(infoMock).toHaveBeenCalledWith(
      { importId: validPayload.importId },
      'Import already recorded, skipping duplicate download trigger',
    );
  });

  it('should throw and not call findByImportId, when the payload fails schema validation', async () => {
    const findByImportId = vi.fn();
    const requestContextService = new RequestContextService();
    const { controller } = buildController(findByImportId, vi.fn(), requestContextService);

    await requestContextService.run({ correlationId, requestId: correlationId }, async () => {
      await expect(controller.handleDownload({ importId: 'not-a-uuid' })).rejects.toThrow();
    });
    expect(findByImportId).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- download-import.controller.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement the controller**

`back-end/service-a/src/archive/download/download-import.controller.ts`:
```ts
import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';

import { ImportOrchestrationService } from '../import-orchestration.service.js';
import { ImportRunTracker } from '../import-run-tracker.service.js';

import { downloadImportMessageSchema } from './download-import-message.schema.js';

const ALREADY_RECORDED_LOG_MESSAGE = 'Import already recorded, skipping duplicate download trigger';

@Controller()
export class DownloadImportController {
  public constructor(
    private readonly importOrchestrationService: ImportOrchestrationService,
    private readonly importRunTracker: ImportRunTracker,
    private readonly requestContextService: RequestContextService,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger('DownloadImportController');
  }

  @EventPattern('archive.import.download')
  public async handleDownload(@Payload() payload: unknown): Promise<void> {
    const { importId, dateHour } = downloadImportMessageSchema.parse(payload);
    const existing = await this.importRunTracker.findByImportId(importId);

    if (existing !== null) {
      this.logger.info({ importId }, ALREADY_RECORDED_LOG_MESSAGE);

      return;
    }

    const { correlationId } = this.requestContextService.requireContext();

    await this.importOrchestrationService.importDownload(dateHour, importId, correlationId);
  }

  private readonly logger: AppLogger;
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- download-import.controller.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 10: Stage the files**

```bash
git add back-end/service-a/src/archive/download/download-import-message.schema.ts back-end/service-a/src/archive/download/download-import-message.schema.spec.ts back-end/service-a/src/archive/download/download-import.controller.ts back-end/service-a/src/archive/download/download-import.controller.spec.ts
```

---

## Task 11: `service-a` — route uploads through `ImportOrchestrationService`

**Files:**
- Modify: `back-end/service-a/src/archive/upload/upload-import.controller.ts`
- Modify: `back-end/service-a/src/archive/upload/upload-import.controller.spec.ts`

**Interfaces:**
- Consumes: `ImportOrchestrationService.importUpload` (Task 9), `RequestContextService`.
- Changes: `UploadImportController.handleUpload` now calls `importOrchestrationService.importUpload`
  instead of calling `ArchiveProcessingService.process` directly — so an upload-triggered import gets
  the exact same lifecycle events, metrics, and `imports`-collection tracking a download-triggered one
  gets (per the design doc's data model: "One document per import run (download-triggered or
  upload-triggered)"). `ArchiveProcessingService` itself is untouched — `ImportOrchestrationService`
  still calls it internally (Task 9).

- [ ] **Step 1: Update the failing tests**

Modify `back-end/service-a/src/archive/upload/upload-import.controller.spec.ts` to:
```ts
import { RequestContextService } from '@task1/shared/request-context/request-context.service';

import { type ImportOrchestrationService } from '../import-orchestration.service.js';

import { UploadImportController } from './upload-import.controller.js';

describe('UploadImportController', () => {
  const validPayload = {
    importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    filePath: '/data/archives/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.json.gz',
  };
  const correlationId = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  function buildController(
    importUpload: ReturnType<typeof vi.fn>,
    requestContextService: RequestContextService,
  ): UploadImportController {
    const importOrchestrationService = { importUpload } as unknown as ImportOrchestrationService;

    return new UploadImportController(importOrchestrationService, requestContextService);
  }

  it('should call ImportOrchestrationService.importUpload with the validated filePath, importId, and correlationId, when the payload is valid', async () => {
    const importUpload = vi.fn().mockResolvedValue({
      eventsProcessed: 1,
      validEvents: 1,
      invalidEvents: 0,
      duplicateEvents: 0,
      errorCount: 0,
    });
    const requestContextService = new RequestContextService();
    const controller = buildController(importUpload, requestContextService);

    await requestContextService.run({ correlationId, requestId: correlationId }, async () => {
      await controller.handleUpload(validPayload);
    });

    expect(importUpload).toHaveBeenCalledWith(
      validPayload.filePath,
      validPayload.importId,
      correlationId,
    );
  });

  it('should throw and not call ImportOrchestrationService.importUpload, when the payload fails schema validation', async () => {
    const importUpload = vi.fn();
    const requestContextService = new RequestContextService();
    const controller = buildController(importUpload, requestContextService);

    await requestContextService.run({ correlationId, requestId: correlationId }, async () => {
      await expect(controller.handleUpload({ importId: 'not-a-uuid' })).rejects.toThrow();
    });
    expect(importUpload).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- upload-import.controller.spec.ts`
Expected: FAIL — `UploadImportController`'s constructor doesn't accept `ImportOrchestrationService`/
`RequestContextService` yet, and `handleUpload` still calls the old dependency.

- [ ] **Step 3: Update the controller**

Modify `back-end/service-a/src/archive/upload/upload-import.controller.ts` to:
```ts
import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';

import { ImportOrchestrationService } from '../import-orchestration.service.js';

import { uploadImportMessageSchema } from './upload-import-message.schema.js';

@Controller()
export class UploadImportController {
  public constructor(
    private readonly importOrchestrationService: ImportOrchestrationService,
    private readonly requestContextService: RequestContextService,
  ) {}

  @EventPattern('archive.process.upload')
  public async handleUpload(@Payload() payload: unknown): Promise<void> {
    const { importId, filePath } = uploadImportMessageSchema.parse(payload);
    const { correlationId } = this.requestContextService.requireContext();

    await this.importOrchestrationService.importUpload(filePath, importId, correlationId);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- upload-import.controller.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/archive/upload/upload-import.controller.ts back-end/service-a/src/archive/upload/upload-import.controller.spec.ts
```

---

## Task 12: `service-a` — wire everything into `ArchiveModule` and document new env vars

**Files:**
- Modify: `back-end/service-a/src/archive/archive.module.ts`
- Modify: `back-end/service-a/.env.example`

**Interfaces:** none new — this task only wires Tasks 3-11's providers/controllers together and
registers the new outbound `ClientsModule`, exactly mirroring the gateway's existing
`ClientsModule.registerAsync` shape (Finding 2).

- [ ] **Step 1: Wire the new module**

Modify `back-end/service-a/src/archive/archive.module.ts` to:
```ts
import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { LoggerModule } from '@task1/shared/logger/rmq/logger.module';

import rabbitmqConfig from '../config/rabbitmq.config.js';

import { ArchiveDownloadService } from './download/archive-download.service.js';
import { DownloadImportController } from './download/download-import.controller.js';
import { EnsureEventIndexesInitializer } from './ensure-event-indexes-initializer.service.js';
import { EnsureImportIndexesInitializer } from './ensure-import-indexes-initializer.service.js';
import { eventsCollectionProvider } from './events-collection.provider.js';
import { ImportOrchestrationService } from './import-orchestration.service.js';
import { ImportRunTracker } from './import-run-tracker.service.js';
import { importsCollectionProvider } from './imports-collection.provider.js';
import { SERVICE_B_RMQ_CLIENT } from './rabbitmq-client.token.js';
import { ArchiveProcessingService } from './upload/archive-processing.service.js';
import { UploadImportController } from './upload/upload-import.controller.js';

@Module({
  imports: [
    LoggerModule,
    ClientsModule.registerAsync([
      {
        name: SERVICE_B_RMQ_CLIENT,
        inject: [rabbitmqConfig.KEY],
        useFactory: (config: ConfigType<typeof rabbitmqConfig>) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.url],
            queue: config.serviceBQueue,
            queueOptions: { durable: true },
          },
        }),
      },
    ]),
  ],
  controllers: [UploadImportController, DownloadImportController],
  providers: [
    eventsCollectionProvider,
    importsCollectionProvider,
    EnsureEventIndexesInitializer,
    EnsureImportIndexesInitializer,
    ArchiveProcessingService,
    ArchiveDownloadService,
    ImportRunTracker,
    ImportOrchestrationService,
  ],
})
export class ArchiveModule {}
```

- [ ] **Step 2: Document the new environment variables**

Modify `back-end/service-a/.env.example` to:
```
RABBITMQ_URL=amqp://guest:guest@localhost:5672
RABBITMQ_QUEUE=service_a_queue
RABBITMQ_SERVICE_B_QUEUE=service_b_queue

MONGODB_URI=mongodb://localhost:27017/service_a
MONGO_BATCH_SIZE=500

REDIS_URL=redis://localhost:6379
REDIS_METRICS_RETENTION_MS=604800000

STORAGE_DIR=./data/archives

GITHUB_ARCHIVE_BASE_URL=https://data.gharchive.org
ARCHIVE_DOWNLOAD_TIMEOUT_MS=30000

LOG_LEVEL=trace
APP_LOG_TRANSPORT=pretty
```

- [ ] **Step 3: Run the full `service-a` test suite, lint, and build**

Run: `pnpm --filter service-a test && pnpm --filter service-a lint && pnpm --filter service-a build`
Expected: all three PASS/succeed — this is the first point every file from Tasks 1-12 is wired together
and compiled as one program, including `AppModule`'s existing `ArchiveModule` import picking up the two
new controllers and every new provider.

- [ ] **Step 4: Stage the files**

```bash
git add back-end/service-a/src/archive/archive.module.ts back-end/service-a/.env.example
```

---

## Task 13: `api-gateway` — `POST /v1/imports` (download trigger) with `Idempotency-Key`

**Files:**
- Create: `back-end/api-gateway/src/imports/dto/trigger-download-import.dto.ts`
- Create: `back-end/api-gateway/src/imports/dto/trigger-import-response.dto.ts`
- Modify: `back-end/api-gateway/src/imports/errors.ts`
- Modify: `back-end/api-gateway/src/imports/errors.spec.ts` (create if it does not already exist — see
  Step 1)
- Create: `back-end/api-gateway/src/imports/trigger-import.controller.ts`
- Create: `back-end/api-gateway/src/imports/trigger-import.controller.int.spec.ts`
- Modify: `back-end/api-gateway/src/imports/imports.module.ts`

**Interfaces:**
- Consumes: `SERVICE_A_RMQ_CLIENT` (Phase 3, existing — the trigger message goes to service-a, which
  owns the `imports` collection and the idempotency check, per Task 10).
- Produces: `TriggerDownloadImportDto { dateHour: string }` (class-validator, `@Matches` against the same
  `YYYY-MM-DD-H` pattern service-a's `buildArchiveUrl` already enforces — validated again here purely as
  a fast-fail at the HTTP boundary; service-a still re-validates internally regardless, per `CLAUDE.md`'s
  "never trust external input" — this is defense in depth across two different trust boundaries, not a
  DRY violation). `TriggerImportResponseDto { importId: string }`. `InvalidIdempotencyKeyError extends
  ValidationError`. `TriggerImportController` — `POST /imports`, emits `'archive.import.download'`
  fire-and-forget (matching the existing upload endpoint's `emit`, not `send` — the whole point of
  emit-and-return-immediately is that the gateway never blocks on a potentially long-running download).
- Consumed by: nothing later in this plan — this is the final gateway-facing piece for this phase.

- [ ] **Step 1: Check whether `errors.spec.ts` already exists for the imports module**

Run: `ls back-end/api-gateway/src/imports/errors.spec.ts 2>/dev/null || echo "not found"`
Expected: "not found" — the existing `errors.ts` (Phase 3) has no dedicated spec file today (its
throw-behavior is exercised indirectly by `upload-import.controller.int.spec.ts`, matching this repo's
established convention for simple `AppError` subclasses — see Phase 1/2's `errors.ts` files). This task
follows the same convention: no dedicated spec file for `InvalidIdempotencyKeyError` either; it's
exercised by Step 8's integration test instead.

- [ ] **Step 2: Add `InvalidIdempotencyKeyError`**

Modify `back-end/api-gateway/src/imports/errors.ts` to append:
```ts
export class InvalidIdempotencyKeyError extends ValidationError {
  public constructor(idempotencyKey: string) {
    super(
      `Idempotency-Key header must be a UUID; received "${idempotencyKey}"`,
      InvalidIdempotencyKeyError.buildOptions({
        code: 'INVALID_IDEMPOTENCY_KEY',
        category: ErrorCategory.VALIDATION,
        params: { idempotencyKey },
      }),
    );
  }
}
```
(The file's existing `import { AppError, ErrorCategory, ValidationError } from '@task1/shared/errors/
index';` line already imports everything this new class needs — no import changes required.)

- [ ] **Step 3: Add the request DTO**

`back-end/api-gateway/src/imports/dto/trigger-download-import.dto.ts`:
```ts
import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

const DATE_HOUR_PATTERN = /^\d{4}-\d{2}-\d{2}-([0-9]|1[0-9]|2[0-3])$/;

export class TriggerDownloadImportDto {
  @ApiProperty({
    description: 'The GitHub Archive hour to import, formatted YYYY-MM-DD-H (hour 0-23, no leading zero).',
    example: '2026-08-11-0',
  })
  @Matches(DATE_HOUR_PATTERN, { message: 'dateHour must match YYYY-MM-DD-H (hour 0-23)' })
  public readonly dateHour!: string;
}
```

- [ ] **Step 4: Add the response DTO**

`back-end/api-gateway/src/imports/dto/trigger-import-response.dto.ts`:
```ts
import { ApiProperty } from '@nestjs/swagger';

export class TriggerImportResponseDto {
  @ApiProperty({
    description: 'Public identifier of the newly created (or replayed) import run',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  public readonly importId: string;

  public constructor(importId: string) {
    this.importId = importId;
  }
}
```

- [ ] **Step 5: Write the failing integration tests for the controller**

`back-end/api-gateway/src/imports/trigger-import.controller.int.spec.ts`:
```ts
import { type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { Test, type TestingModule } from '@nestjs/testing';
import loggerConfig from '@task1/shared/config/logger.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/http/exception-handling.module';
import { RequestContextModule } from '@task1/shared/request-context/http/request-context.module';
import request from 'supertest';

import { AuthGuard } from '../auth/auth.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import rabbitmqConfig from '../config/rabbitmq.config.js';
import storageConfig from '../config/storage.config.js';
import uploadConfig from '../config/upload.config.js';

import { ImportsModule } from './imports.module.js';
import { SERVICE_A_RMQ_CLIENT } from './rabbitmq-client.token.js';

type App = Parameters<typeof request>[0];
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- local destructuring shape for the mocked emit() call, not a domain interface.
type EmittedMessage = { importId: string; dateHour: string };

describe('TriggerImportController (HTTP Integration)', () => {
  let app: INestApplication;
  let httpServer: App;
  let serviceAClient: { emit: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    serviceAClient = { emit: vi.fn() };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [storageConfig, uploadConfig, rabbitmqConfig, loggerConfig],
        }),
        RequestContextModule,
        ExceptionHandlingModule,
        AuthModule,
        ImportsModule,
      ],
    })
      .overrideProvider(SERVICE_A_RMQ_CLIENT)
      .useValue(serviceAClient as unknown as ClientProxy)
      .overrideProvider(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    httpServer = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /imports', () => {
    it('should return 202 with a generated importId and emit the download trigger, when no Idempotency-Key is supplied', async () => {
      const response = await request(httpServer).post('/imports').send({ dateHour: '2026-08-11-0' });

      expect(response.status).toBe(202);
      expect(typeof (response.body as { importId: string }).importId).toBe('string');
      expect(serviceAClient.emit).toHaveBeenCalledTimes(1);

      const [pattern, payload] = serviceAClient.emit.mock.calls[0] as [string, EmittedMessage];

      expect(pattern).toBe('archive.import.download');
      expect(payload.importId).toBe((response.body as { importId: string }).importId);
      expect(payload.dateHour).toBe('2026-08-11-0');
    });

    it('should use the Idempotency-Key as the importId, when a valid UUID key is supplied', async () => {
      const idempotencyKey = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

      const response = await request(httpServer)
        .post('/imports')
        .set('Idempotency-Key', idempotencyKey)
        .send({ dateHour: '2026-08-11-0' });

      expect(response.status).toBe(202);
      expect((response.body as { importId: string }).importId).toBe(idempotencyKey);

      const [, payload] = serviceAClient.emit.mock.calls[0] as [string, EmittedMessage];

      expect(payload.importId).toBe(idempotencyKey);
    });

    it('should return the same importId and emit again with the same importId, when the same Idempotency-Key is replayed', async () => {
      const idempotencyKey = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

      const first = await request(httpServer)
        .post('/imports')
        .set('Idempotency-Key', idempotencyKey)
        .send({ dateHour: '2026-08-11-0' });
      const second = await request(httpServer)
        .post('/imports')
        .set('Idempotency-Key', idempotencyKey)
        .send({ dateHour: '2026-08-11-0' });

      expect((first.body as { importId: string }).importId).toBe(idempotencyKey);
      expect((second.body as { importId: string }).importId).toBe(idempotencyKey);
      expect(serviceAClient.emit).toHaveBeenCalledTimes(2);
      // Replay-safety itself (skipping a second real import) is enforced inside
      // service-a's DownloadImportController (Task 10) via the imports collection —
      // the gateway's only job is deterministic importId resolution, asserted above.
    });

    it('should return 400 and not emit, when the Idempotency-Key is not a valid UUID', async () => {
      const response = await request(httpServer)
        .post('/imports')
        .set('Idempotency-Key', 'not-a-uuid')
        .send({ dateHour: '2026-08-11-0' });

      expect(response.status).toBe(400);
      expect(serviceAClient.emit).not.toHaveBeenCalled();
    });

    it('should return 400 and not emit, when dateHour does not match the required format', async () => {
      const response = await request(httpServer).post('/imports').send({ dateHour: 'not-a-date-hour' });

      expect(response.status).toBe(400);
      expect(serviceAClient.emit).not.toHaveBeenCalled();
    });

    it('should return 400 and not emit, when dateHour is missing', async () => {
      const response = await request(httpServer).post('/imports').send({});

      expect(response.status).toBe(400);
      expect(serviceAClient.emit).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter api-gateway test -- trigger-import.controller.int.spec.ts`
Expected: FAIL — `trigger-import.controller.js` module not found (and `ImportsModule` doesn't register
it yet).

- [ ] **Step 7: Implement the controller**

`back-end/api-gateway/src/imports/trigger-import.controller.ts`:
```ts
import { randomUUID } from 'node:crypto';

import { Body, Controller, Headers, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { type ClientProxy } from '@nestjs/microservices';
import { ApiAcceptedResponse, ApiHeader, ApiTags } from '@nestjs/swagger';
import { isUUID } from 'class-validator';

import { TriggerDownloadImportDto } from './dto/trigger-download-import.dto.js';
import { TriggerImportResponseDto } from './dto/trigger-import-response.dto.js';
import { InvalidIdempotencyKeyError } from './errors.js';
import { SERVICE_A_RMQ_CLIENT } from './rabbitmq-client.token.js';

const ARCHIVE_IMPORT_DOWNLOAD_PATTERN = 'archive.import.download';

@ApiTags('imports')
@Controller('imports')
export class TriggerImportController {
  public constructor(@Inject(SERVICE_A_RMQ_CLIENT) private readonly serviceAClient: ClientProxy) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Client-supplied UUID. Replaying the same key returns the same importId and does not start a second import.',
  })
  @ApiAcceptedResponse({ type: TriggerImportResponseDto })
  public trigger(
    @Body() dto: TriggerDownloadImportDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): TriggerImportResponseDto {
    if (idempotencyKey !== undefined && !isUUID(idempotencyKey)) {
      throw new InvalidIdempotencyKeyError(idempotencyKey);
    }

    const importId = idempotencyKey ?? randomUUID();

    this.serviceAClient.emit(ARCHIVE_IMPORT_DOWNLOAD_PATTERN, { importId, dateHour: dto.dateHour });

    return new TriggerImportResponseDto(importId);
  }
}
```

- [ ] **Step 8: Wire the controller into `ImportsModule`**

Modify `back-end/api-gateway/src/imports/imports.module.ts` — add the new controller to the existing
`controllers` array (everything else in the file is unchanged):
```ts
  controllers: [UploadImportController, TriggerImportController],
```
(and add `import { TriggerImportController } from './trigger-import.controller.js';` to the file's
import block, alphabetized with the existing imports.)

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm --filter api-gateway test -- trigger-import.controller.int.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 10: Run the full `api-gateway` test suite, lint, and build**

Run: `pnpm --filter api-gateway test && pnpm --filter api-gateway lint && pnpm --filter api-gateway build`
Expected: all three PASS/succeed.

- [ ] **Step 11: Stage the files**

```bash
git add back-end/api-gateway/src/imports/dto/trigger-download-import.dto.ts back-end/api-gateway/src/imports/dto/trigger-import-response.dto.ts back-end/api-gateway/src/imports/errors.ts back-end/api-gateway/src/imports/trigger-import.controller.ts back-end/api-gateway/src/imports/trigger-import.controller.int.spec.ts back-end/api-gateway/src/imports/imports.module.ts
```

---

## Task 14: End-to-end verification against real infrastructure

**Files:** none — this task only runs commands and reads output. Every task above is tested against
mocked Mongo/Redis/RabbitMQ clients (this repo's established convention) — this is the "does it actually
work end-to-end" checkpoint those tests can't cover, matching how Phases 0-3 each closed with the same
kind of real-infrastructure check.

- [ ] **Step 1: Build and start the full stack**

Run: `pnpm build && pnpm docker:up`
Expected: `pnpm build` succeeds for every workspace package; `docker compose` brings every container to a
healthy state, `service-a` logs `"Connected to MongoDB"` and `"Connected to Redis"` at boot (unchanged
from Phase 0) with no new fatal/error-level lines despite the new `SERVICE_B_RMQ_CLIENT` connecting on
module init.

- [ ] **Step 2: Trigger a real download import through the gateway**

Pick any `dateHour` at least 24 hours before the current date (GitHub Archive has processing lag).
Run:
```bash
curl -s -X POST http://localhost:3000/api/v1/imports \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" \
  -d '{"dateHour":"2026-08-10-0"}'
```
(substitute a real `dateHour` at least a day in the past). Expected: `202 Accepted` with
`{"importId":"a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"}` (matching the supplied `Idempotency-Key`).

- [ ] **Step 3: Confirm the import actually ran**

Run: `docker compose logs service-a | grep -i "import"`
Expected: no fatal/error-level lines; give the archive a minute or two to download and process
(depends on real network speed to `data.gharchive.org`) before the next step.

- [ ] **Step 4: Confirm the `imports` and `events` collections were written**

Run:
```bash
docker compose exec mongodb mongosh service_a --quiet --eval "db.imports.findOne({importId:'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'})"
docker compose exec mongodb mongosh service_a --quiet --eval "db.events.countDocuments({importId:'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'})"
```
Expected: the `imports` document shows `status: 'completed'` with real, nonzero counters; the `events`
count matches the import's `validEvents` counter.

- [ ] **Step 5: Confirm the RedisTimeSeries metrics were recorded**

Run:
```bash
docker compose exec redis redis-cli TS.RANGE service_a.archive.events.processed - +
docker compose exec redis redis-cli TS.RANGE service_a.archive.processing.duration - +
```
Expected: at least one sample in each series (proves `TS.ADD`'s auto-create-on-first-use behavior from
Global Constraints' Finding 1 actually works against a real `redis-stack-server`, not just the mocked
unit test).

- [ ] **Step 6: Confirm the lifecycle events actually reached `service_b_queue`**

Service-b doesn't consume these yet (that's Phase 6) — confirm they landed on the queue instead, via the
RabbitMQ management API:
```bash
curl -s -u guest:guest http://localhost:15672/api/queues/%2f/service_b_queue | grep -o '"messages":[0-9]*'
```
Expected: `"messages":2` (the `import.started` and `import.completed` messages from Step 2's run,
un-consumed and waiting — this is expected and correct until Phase 6 adds a consumer; queue depth
returns to what it was before Step 2 once Phase 6 lands).

- [ ] **Step 7: Confirm the `Idempotency-Key` replay path is a real no-op, not just an HTTP-layer illusion**

Re-run Step 2's exact `curl` command a second time with the same `Idempotency-Key`.
Run: `curl -s -u guest:guest http://localhost:15672/api/queues/%2f/service_b_queue | grep -o '"messages":[0-9]*'`
Expected: the response to the second `curl` is still `202` with the same `importId`, but the queue's
message count is unchanged from Step 6 — proving `DownloadImportController`'s `findByImportId` check
(Task 10) actually prevented a second `import.started`/`.completed` pair from being emitted, not just
that the gateway returned a cached-looking response.

- [ ] **Step 8: Tear down**

Run: `pnpm docker:down`
Expected: all containers stop cleanly.

---

## Self-Review

**Spec coverage:** the design doc's "Service-a: RabbitMQ domain events (Phase 5)" section (mint
`importId`, emit started/completed/failed, `emit` not `send`, metadata-only payload) maps to Task 8's
`import-archive.ts`. The "Service-a: RedisTimeSeries metrics (Phase 5)" section (idempotent creation with
retention, inline recording, never fails the primary import on Redis failure) maps to Task 3's
`MetricsService`, verified against RedisTimeSeries's real `TS.ADD` auto-create behavior rather than
guessed (Finding 1). The `imports` collection's role in the "Data model" section (one document per run,
either source) maps to Tasks 4-6. Phase 10's `Idempotency-Key` note maps to Task 13, with the actual
existence-check living in service-a (Task 10) per the module-boundary rule rather than in the gateway.
The roadmap's stated testable deliverable — "unit test asserting the emit sequence... metrics recorded at
each stage... gateway `.int.spec.ts` for `POST /v1/imports` including the Idempotency-Key replay case" —
is covered exactly by Task 8's tests, Task 3's tests, and Task 13's six integration tests. The three
scope decisions called out in Global Constraints (no `processing` status, no generic API-request
metrics, no correlationId-propagation fix) are each explicitly justified rather than silent gaps.

**Placeholder scan:** no TBD/TODO; every task shows complete file contents or an exact runnable command
with an expected result.

**Type/name consistency:** `ImportResult` (Phase 2, unchanged) flows through `ImportRunTracker`,
`import-archive.ts`, and `ImportOrchestrationService` with the identical field names throughout.
`ImportSourceRecord`/`IImportRunDocument` (Task 4) are used identically by `ImportRunTracker` (Task 6)
and `import-archive.ts` (Task 8). `SERVICE_B_RMQ_CLIENT` (Task 8) is the exact token both
`ImportOrchestrationService` (Task 9) and `ArchiveModule`'s new `ClientsModule.registerAsync` (Task 12)
reference. `IImportArchiveDependencies`'s seven fields (Task 8) are implemented with matching names and
signatures by `ImportOrchestrationService.buildDependencies()` (Task 9) — verified field-by-field:
`downloadArchive`, `processArchive`, `emitEvent`, `recordMetric`, `recordImportStarted`,
`recordImportCompleted`, `recordImportFailed`. `ArchiveDownloadService.download(dateHour, httpGet?)`
(Task 7) and `ArchiveProcessingService.process(filePath, importId)` (Phase 3, unchanged) are called with
matching arity everywhere they're used (Task 9's dependency bag, Task 7/Phase 3's own specs).
`downloadImportMessageSchema`/`uploadImportMessageSchema`'s `{importId, ...}` shape is consistent with
every controller that parses one (Tasks 10, 11).
