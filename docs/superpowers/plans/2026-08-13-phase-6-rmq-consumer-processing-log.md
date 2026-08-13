# Phase 6: Service-b RabbitMQ Consumer & Processing-Log Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `service-b` consumes the three `github.import.*` lifecycle events Phase 5 already emits and
idempotently persists them into its own `processing-logs` MongoDB collection, keyed by `{importId,
status}` so redelivery is a no-op. Consumer concurrency is bounded (`prefetchCount`), and a write
failure is retried a bounded number of times before the message is dead-lettered instead of retried
forever.

**Architecture:** Three `@EventPattern` handlers (`github.import.started/.completed/.failed`) on a new
`ImportEventsController`, each: Zod-validate the payload with the schema Phase 0 already put in
`@task1/shared/github-archive/index` → map it to a `IProcessingLogDocument` via a pure mapper function →
`ProcessingLogTracker.upsertLog` (a plain Mongo `updateOne` upsert, not a `Repository` class — matching
this codebase's existing `ImportRunTracker` precedent) → manually ack. All three handlers share one
private orchestration method so the ack/retry/dead-letter mechanics exist in exactly one place.
Switching to manual acknowledgement (required for bounded retry) is a `service-b`-wide transport setting,
so it also touches the existing `HealthController`, which currently relies on Nest's default auto-ack.

**Tech Stack:** `@nestjs/microservices` (`@EventPattern`, `@Ctx`, `RmqContext`), official `mongodb` driver
(already a `service-b` dependency, unused until now), Zod (schemas reused from `@task1/shared`), Vitest.

**Design doc:** `docs/superpowers/specs/2026-08-12-github-archive-platform-design.md` (section
"Service-b: RabbitMQ consumer & processing-log storage (Phase 6)")
**Roadmap:** `docs/superpowers/plans/2026-08-12-github-archive-platform-plan.md` (Phase 6 of 11)
**Depends on:** Phase 0 (shared event contracts, `service-b`'s Mongo/Redis infra — already merged),
Phase 5 (the three events this phase consumes are already being emitted by `service-a` — already merged).

Every file path, type, and function signature below was read from the actual current code in this repo
(`back-end/service-b/src/**`, `back-end/libs/shared/src/github-archive/**`) before this plan was written,
not from the roadmap's higher-level sketch. Two non-obvious findings are called out below because
implementing this phase naively — exactly as the roadmap's one-line description reads — would either
silently break an existing feature or produce an untestable design.

## Global Constraints

- **Finding 1 — switching to manual ack is transport-wide, not per-handler, and it breaks the existing
  `HealthController` if left unfixed.** `@nestjs/microservices`'s RMQ server acks automatically only when
  `noAck` (default `true`) is left at its default; `noAck` is a single option on the whole microservice
  (`back-end/service-b/src/main.ts`'s `NestFactory.createMicroservice` call), not something a controller
  opts into per-handler. Checked directly against the installed
  `@nestjs/microservices/server/server-rmq.js`: `channel.consume(queue, handleMessage, { noAck: this.noAck
  })`, and neither `handleMessage` nor `handleEvent` ever calls `channel.ack` themselves — with `noAck:
  false`, **every** handler on the microservice must ack manually via `context.getChannelRef().ack(...)`,
  or its message (and, once `prefetchCount` messages are stuck unacked, every subsequent message) never
  gets acknowledged. `back-end/service-b/src/health/health.controller.ts`'s `@MessagePattern('health.check')`
  handler currently returns a value without ever touching a channel — Task 2 below fixes it in the same
  step that turns `noAck: false` on, so the two changes land atomically and health checks don't silently
  start leaking unacked messages.
- **Finding 2 — the design doc's own prose defers the retry/dead-letter *mechanism* ("exact mechanism
  decided at Phase 6 implementation time"); this plan picks the header-counted, plain-queue approach, not
  a dead-letter-exchange/`x-death` topology.** A DLX-based retry loop is real RabbitMQ broker behavior that
  can only be exercised against a live broker — this repo's test suite explicitly prohibits live external
  services / Testcontainers (`skills/testing-development.md`, confirmed, not assumed), so a DLX-based design
  would have zero automated coverage for its actual retry/dead-letter logic. Instead: on a repository write
  failure, the consumer reads an `x-retry-count` header off the *original* message (default 0), and either
  republishes an identical copy with that header incremented back onto `service-b`'s own queue (below
  `maxRetries`) or onto a plain dead-letter queue (`service_b_queue.dlq`, asserted idempotently right before
  first use — no upfront topology to keep in sync) — then acks the original either way. This is plain
  application code, fully exercised by a mocked channel in Vitest, and needs zero new AMQP
  exchange/binding configuration (`docker-compose.yml` is untouched this phase) — satisfies `CLAUDE.md`'s
  "no new infrastructure components" and simplicity principles.
- **Scope decision — this phase creates only the `{importId: 1, status: 1}` unique index.** The design
  doc's own phase split lists the `{importId:1,timestamp:-1}` / `{status:1,timestamp:-1}` / default
  `{timestamp:-1,_id:-1}` indexes under "Service-b: log query API (**Phase 7**)", not this one — nothing
  in this phase queries by those patterns yet, so creating them now would be dead index maintenance
  overhead ahead of the feature that needs them. Phase 7's plan adds them alongside the query API itself.
- **Reuses `@task1/shared/github-archive/index` as-is — no shared-package changes this phase.** Phase 0
  already exports `EVENT_PATTERNS`, `importStartedEventSchema`/`importCompletedEventSchema`/
  `importFailedEventSchema`, and the `ImportStartedEvent`/`ImportCompletedEvent`/`ImportFailedEvent` types
  — this phase's controller validates against those directly rather than redefining service-b-local
  copies.
- Never throw raw `Error` — no new `AppError` subclass is needed: `ImportEventsController`'s handlers
  never let an error escape (every failure path is caught and resolved after acking), and
  `ProcessingLogTracker` is a thin Mongo wrapper that lets driver errors propagate to that one catch site
  by design, matching `ImportRunTracker`'s existing precedent of not swallowing errors itself.
- Every failed-import log entry truncates its stored `reason` to 500 characters, mirroring
  `ImportRunTracker.recordFailed`'s existing truncation — bounded storage, not an unbounded audit trail.
- `unicorn/prevent-abbreviations`, `security/detect-non-literal-fs-filename`, `@typescript-eslint/
  consistent-type-imports` (inline `type` modifiers), `import-x/order` (grouped, alphabetized, blank line
  between groups), `@typescript-eslint/naming-convention` (`I`-prefixed interfaces, unprefixed `type`
  aliases), `padding-line-between-statements` (blank line before every `return`/`throw` after a statement,
  and before every `if`) — all exactly as established in Phases 0–5's Global Constraints; not repeated in
  full here.
- No `git commit` in any step — every "commit" checkpoint is written as "stage the files."
- BDD test naming: `it('should X, when Y')`. Coverage thresholds: 90% lines, 90% branches. Mocking
  convention: plain object literals cast `as unknown as <RealType>`, never `vi.mock()`. Direct class
  instantiation (`new X(...)`) over `Test.createTestingModule()` when Nest DI isn't itself under test —
  matching every service-a service test from Phases 0–5.
- Real UUID-shaped literals in every test fixture (`skills/backend-development.md`'s UUID Identifiers
  rule) — `a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11` (importId) / `b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`
  (correlationId), reusing the exact literals Phase 5's own tests already use for continuity across the
  same importId in examples.

---

## Task 1: `service-b` — add `prefetchCount`/`maxRetries`/`deadLetterQueue` to `rabbitmq.config.ts`

**Files:**
- Modify: `back-end/service-b/src/config/rabbitmq.config.ts`
- Modify: `back-end/service-b/src/config/rabbitmq.config.spec.ts`
- Modify: `back-end/service-b/.env.example`

**Interfaces:**
- Produces: `RabbitmqConfiguration { url: string; queue: string; prefetchCount: number; maxRetries:
  number; deadLetterQueue: string }` — adds `prefetchCount` (default `10`, env
  `RABBITMQ_PREFETCH_COUNT`), `maxRetries` (default `5`, env `RABBITMQ_MAX_RETRIES`), `deadLetterQueue`
  (default `'service_b_queue.dlq'`, env `RABBITMQ_DEAD_LETTER_QUEUE`) alongside the existing `url`/`queue`
  fields, unchanged.
- Consumed by: Task 2 (`main.ts`'s microservice options), Task 8 (`ImportEventsController`'s retry/DLQ
  logic).

- [ ] **Step 1: Write the failing test**

Modify `back-end/service-b/src/config/rabbitmq.config.spec.ts` to:
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
      delete process.env.RABBITMQ_PREFETCH_COUNT;
      delete process.env.RABBITMQ_MAX_RETRIES;
      delete process.env.RABBITMQ_DEAD_LETTER_QUEUE;

      expect(rabbitmqConfig()).toEqual({
        url: 'amqp://guest:guest@localhost:5672',
        queue: 'service_b_queue',
        prefetchCount: 10,
        maxRetries: 5,
        deadLetterQueue: 'service_b_queue.dlq',
      });
    });
  });

  describe('environment overrides', () => {
    it('should parse values from environment variables, when all variables are set', () => {
      process.env.RABBITMQ_URL = 'amqp://user:pass@rabbit-host:5672';
      process.env.RABBITMQ_QUEUE = 'custom_service_b_queue';
      process.env.RABBITMQ_PREFETCH_COUNT = '20';
      process.env.RABBITMQ_MAX_RETRIES = '3';
      process.env.RABBITMQ_DEAD_LETTER_QUEUE = 'custom_service_b_queue.dlq';

      expect(rabbitmqConfig()).toEqual({
        url: 'amqp://user:pass@rabbit-host:5672',
        queue: 'custom_service_b_queue',
        prefetchCount: 20,
        maxRetries: 3,
        deadLetterQueue: 'custom_service_b_queue.dlq',
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

    it('should throw, when RABBITMQ_PREFETCH_COUNT is not a positive number', () => {
      process.env.RABBITMQ_PREFETCH_COUNT = '0';

      expect(() => rabbitmqConfig()).toThrow();
    });

    it('should throw, when RABBITMQ_MAX_RETRIES is not a positive number', () => {
      process.env.RABBITMQ_MAX_RETRIES = '0';

      expect(() => rabbitmqConfig()).toThrow();
    });

    it('should throw, when RABBITMQ_DEAD_LETTER_QUEUE is an empty string', () => {
      process.env.RABBITMQ_DEAD_LETTER_QUEUE = '';

      expect(() => rabbitmqConfig()).toThrow();
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- rabbitmq.config.spec.ts`
Expected: FAIL — `prefetchCount`/`maxRetries`/`deadLetterQueue` are `undefined` in the actual result; the
three new validation cases have nothing to reject yet.

- [ ] **Step 3: Implement the change**

Modify `back-end/service-b/src/config/rabbitmq.config.ts` to:
```ts
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const rabbitmqConfigSchema = z.object({
  url: z.url().default('amqp://guest:guest@localhost:5672'),
  queue: z.string().min(1).default('service_b_queue'),
  prefetchCount: z.coerce.number().int().positive().default(10),
  maxRetries: z.coerce.number().int().positive().default(5),
  deadLetterQueue: z.string().min(1).default('service_b_queue.dlq'),
});

export type RabbitmqConfiguration = z.infer<typeof rabbitmqConfigSchema>;

export default registerAs('rabbitmq', (): RabbitmqConfiguration =>
  rabbitmqConfigSchema.parse({
    url: process.env.RABBITMQ_URL,
    queue: process.env.RABBITMQ_QUEUE,
    prefetchCount: process.env.RABBITMQ_PREFETCH_COUNT,
    maxRetries: process.env.RABBITMQ_MAX_RETRIES,
    deadLetterQueue: process.env.RABBITMQ_DEAD_LETTER_QUEUE,
  }),
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- rabbitmq.config.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Document the new variables**

Modify `back-end/service-b/.env.example` to:
```
RABBITMQ_URL=amqp://guest:guest@localhost:5672
RABBITMQ_QUEUE=service_b_queue
RABBITMQ_PREFETCH_COUNT=10
RABBITMQ_MAX_RETRIES=5
RABBITMQ_DEAD_LETTER_QUEUE=service_b_queue.dlq

MONGODB_URI=mongodb://localhost:27017/service_b

REDIS_URL=redis://localhost:6379

LOG_LEVEL=trace
APP_LOG_TRANSPORT=pretty
```

- [ ] **Step 6: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 7: Stage the files**

```bash
git add back-end/service-b/src/config/rabbitmq.config.ts back-end/service-b/src/config/rabbitmq.config.spec.ts back-end/service-b/.env.example
```

---

## Task 2: `service-b` — manual-ack wiring (`main.ts` + `HealthController`)

**Files:**
- Modify: `back-end/service-b/src/main.ts`
- Modify: `back-end/service-b/src/health/health.controller.ts`
- Modify: `back-end/service-b/src/health/health.controller.spec.ts`

**Interfaces:**
- Consumes: `rabbitmqConfig().prefetchCount` (Task 1).
- Produces: the microservice now runs with `noAck: false` — every current and future `@MessagePattern`/
  `@EventPattern` handler in `service-b` must ack explicitly from here on.
- Consumed by: Task 8 (`ImportEventsController` is written to already assume manual ack).

- [ ] **Step 1: Write the failing test**

Modify `back-end/service-b/src/health/health.controller.spec.ts` to:
```ts
import { type RmqContext } from '@nestjs/microservices';
import { TerminusModule } from '@nestjs/terminus';
import { Test, type TestingModule } from '@nestjs/testing';

import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let controller: HealthController;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  function buildContext(): { context: RmqContext; message: Record<string, unknown>; ack: ReturnType<typeof vi.fn> } {
    const message = { content: Buffer.from('{}'), properties: { headers: {} } };
    const ack = vi.fn();
    const context = {
      getChannelRef: vi.fn().mockReturnValue({ ack }),
      getMessage: vi.fn().mockReturnValue(message),
    } as unknown as RmqContext;

    return { context, message, ack };
  }

  describe('check', () => {
    it('should return ok health check result and ack the message, when health.check message is handled', async () => {
      const { context, message, ack } = buildContext();

      const result = await controller.check(context);

      expect(result).toEqual({
        status: 'ok',
        info: {},
        error: {},
        details: {},
      });
      expect(ack).toHaveBeenCalledWith(message);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- health.controller.spec.ts`
Expected: FAIL — `controller.check` does not accept a context argument and never calls `ack`.

- [ ] **Step 3: Implement the change**

Modify `back-end/service-b/src/health/health.controller.ts` to:
```ts
import { Controller } from '@nestjs/common';
import { Ctx, MessagePattern, type RmqContext } from '@nestjs/microservices';
import { HealthCheckService, type HealthCheckResult } from '@nestjs/terminus';

@Controller()
export class HealthController {
  public constructor(private readonly health: HealthCheckService) {}

  @MessagePattern('health.check')
  public async check(@Ctx() context: RmqContext): Promise<HealthCheckResult> {
    const result = await this.health.check([]);

    context.getChannelRef().ack(context.getMessage());

    return result;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- health.controller.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Turn on manual acknowledgement at the transport level**

Modify `back-end/service-b/src/main.ts`'s `bootstrap` function body to:
```ts
async function bootstrap(): Promise<void> {
  let app: INestMicroservice | undefined;

  try {
    const { url, queue, prefetchCount } = rabbitmqConfig();

    app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
      transport: Transport.RMQ,
      options: {
        urls: [url],
        queue,
        queueOptions: { durable: true },
        noAck: false,
        prefetchCount,
      },
      bufferLogs: true,
    });

    const loggerService = app.get(LoggerService);
    const bootstrapLogger = loggerService.getLogger('Nest', 'bootstrap');
    app.useLogger(new NestLoggerBridge(bootstrapLogger));

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    app.enableShutdownHooks();

    await app.listen();
  } catch (error) {
    if (app === undefined) {
      // eslint-disable-next-line n/no-process-exit -- no DI container available yet to resolve CentralizedErrorHandlerService
      process.exit(1);
    }

    app.get(CentralizedErrorHandlerService).handleError(new FatalError(error));
  }
}
```

(Only the destructured `prefetchCount` and the two new `options` fields — `noAck`/`prefetchCount` —
change; every import and the rest of the function is untouched.)

- [ ] **Step 6: Run the full `service-b` test suite and lint**

Run: `pnpm --filter service-b test && pnpm --filter service-b lint`
Expected: both PASS.

- [ ] **Step 7: Stage the files**

```bash
git add back-end/service-b/src/main.ts back-end/service-b/src/health/health.controller.ts back-end/service-b/src/health/health.controller.spec.ts
```

---

## Task 3: `service-b` — `processing-logs` collection: types, provider, and unique index

**Files:**
- Create: `back-end/service-b/src/processing-log/processing-log.types.ts`
- Create: `back-end/service-b/src/processing-log/processing-log-collection.provider.ts`
- Create: `back-end/service-b/src/processing-log/processing-log-collection.provider.spec.ts`
- Create: `back-end/service-b/src/processing-log/ensure-processing-log-indexes.ts`
- Create: `back-end/service-b/src/processing-log/ensure-processing-log-indexes.spec.ts`

**Interfaces:**
- Consumes: `MONGO_CLIENT` (Phase 0, `back-end/service-b/src/infra/infra-clients.tokens.ts`).
- Produces: `ProcessingLogStatus` (`'started' | 'completed' | 'failed'`), `IProcessingLogDocument` (the
  `processing-logs` collection's document shape — service-b-internal, never exported from
  `@task1/shared`: this collection is never read by another service). `PROCESSING_LOG_COLLECTION` DI
  token, `createProcessingLogCollection(client): Collection<IProcessingLogDocument>`.
  `ensureProcessingLogIndexes(collection): Promise<void>` — idempotently creates the `{importId: 1,
  status: 1}` unique index (this is what makes redelivery-is-a-no-op enforceable at the database level).
- Consumed by: Task 4 (index initializer), Task 6 (`ProcessingLogTracker`).

- [ ] **Step 1: Add the processing-log types (no test — pure interfaces/type aliases, no runtime logic,
  matching this repo's existing `import-run.types.ts` convention)**

`back-end/service-b/src/processing-log/processing-log.types.ts`:
```ts
export type ProcessingLogStatus = 'started' | 'completed' | 'failed';

export interface IProcessingLogErrorInfo {
  reason: string;
}

export interface IProcessingLogDocument {
  importId: string;
  eventType: string;
  service: 'service-a';
  status: ProcessingLogStatus;
  timestamp: Date;
  correlationId: string;
  archive: string;
  metadata: Record<string, number>;
  errorInfo?: IProcessingLogErrorInfo;
}
```

- [ ] **Step 2: Write the failing test for `createProcessingLogCollection`**

`back-end/service-b/src/processing-log/processing-log-collection.provider.spec.ts`:
```ts
import { type MongoClient } from 'mongodb';

import { createProcessingLogCollection } from './processing-log-collection.provider.js';

describe('createProcessingLogCollection', () => {
  it('should return the processing-logs collection from the client default database, when called', () => {
    const collection = { collectionName: 'processing-logs' };
    const collectionFunction = vi.fn().mockReturnValue(collection);
    const db = vi.fn().mockReturnValue({ collection: collectionFunction });
    const client = { db } as unknown as MongoClient;

    const result = createProcessingLogCollection(client);

    expect(result).toBe(collection);
    expect(collectionFunction).toHaveBeenCalledWith('processing-logs');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- processing-log-collection.provider.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `processing-log-collection.provider.ts`**

`back-end/service-b/src/processing-log/processing-log-collection.provider.ts`:
```ts
import { type Collection, type MongoClient } from 'mongodb';

import { MONGO_CLIENT } from '../infra/infra-clients.tokens.js';

import { type IProcessingLogDocument } from './processing-log.types.js';

export const PROCESSING_LOG_COLLECTION = 'PROCESSING_LOG_COLLECTION';

const PROCESSING_LOG_COLLECTION_NAME = 'processing-logs';

export function createProcessingLogCollection(client: MongoClient): Collection<IProcessingLogDocument> {
  return client.db().collection<IProcessingLogDocument>(PROCESSING_LOG_COLLECTION_NAME);
}

export const processingLogCollectionProvider = {
  provide: PROCESSING_LOG_COLLECTION,
  inject: [MONGO_CLIENT],
  useFactory: createProcessingLogCollection,
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- processing-log-collection.provider.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Write the failing test for `ensureProcessingLogIndexes`**

`back-end/service-b/src/processing-log/ensure-processing-log-indexes.spec.ts`:
```ts
import { type Collection } from 'mongodb';

import { ensureProcessingLogIndexes } from './ensure-processing-log-indexes.js';
import { type IProcessingLogDocument } from './processing-log.types.js';

describe('ensureProcessingLogIndexes', () => {
  it('should create a unique compound index on importId and status, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('importId_1_status_1');
    const collection = { createIndex } as unknown as Collection<IProcessingLogDocument>;

    await ensureProcessingLogIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ importId: 1, status: 1 }, { unique: true });
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- ensure-processing-log-indexes.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 8: Implement `ensure-processing-log-indexes.ts`**

`back-end/service-b/src/processing-log/ensure-processing-log-indexes.ts`:
```ts
import { type Collection } from 'mongodb';

import { type IProcessingLogDocument } from './processing-log.types.js';

export async function ensureProcessingLogIndexes(
  collection: Collection<IProcessingLogDocument>,
): Promise<void> {
  await collection.createIndex({ importId: 1, status: 1 }, { unique: true });
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- ensure-processing-log-indexes.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 10: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 11: Stage the files**

```bash
git add back-end/service-b/src/processing-log/processing-log.types.ts back-end/service-b/src/processing-log/processing-log-collection.provider.ts back-end/service-b/src/processing-log/processing-log-collection.provider.spec.ts back-end/service-b/src/processing-log/ensure-processing-log-indexes.ts back-end/service-b/src/processing-log/ensure-processing-log-indexes.spec.ts
```

---

## Task 4: `service-b` — `EnsureProcessingLogIndexesInitializer`

**Files:**
- Create: `back-end/service-b/src/processing-log/ensure-processing-log-indexes-initializer.service.ts`
- Create: `back-end/service-b/src/processing-log/ensure-processing-log-indexes-initializer.service.spec.ts`

**Interfaces:**
- Consumes: `PROCESSING_LOG_COLLECTION` (Task 3), `ensureProcessingLogIndexes` (Task 3), `LoggerService`
  (`@task1/shared/logger/rmq/logger.service`).
- Produces: `EnsureProcessingLogIndexesInitializer implements OnModuleInit` — runs once at boot, mirrors
  the existing `EnsureImportIndexesInitializer`/`EnsureEventIndexesInitializer` exactly.
- Consumed by: Task 9 (`ProcessingLogModule` providers).

- [ ] **Step 1: Write the failing tests**

`back-end/service-b/src/processing-log/ensure-processing-log-indexes-initializer.service.spec.ts`:
```ts
import { type LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Collection } from 'mongodb';

import { EnsureProcessingLogIndexesInitializer } from './ensure-processing-log-indexes-initializer.service.js';
import { type IProcessingLogDocument } from './processing-log.types.js';

describe('EnsureProcessingLogIndexesInitializer', () => {
  it('should create the unique importId/status index and log success, when the module initializes', async () => {
    const createIndex = vi.fn().mockResolvedValue('importId_1_status_1');
    const collection = { createIndex } as unknown as Collection<IProcessingLogDocument>;
    const infoMock = vi.fn();
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ info: infoMock }),
    } as unknown as LoggerService;
    const initializer = new EnsureProcessingLogIndexesInitializer(collection, loggerService);

    await initializer.onModuleInit();

    expect(createIndex).toHaveBeenCalledWith({ importId: 1, status: 1 }, { unique: true });
    expect(infoMock).toHaveBeenCalledWith({}, 'Ensured processing-logs collection indexes');
  });

  it('should propagate the error, when index creation fails', async () => {
    const createIndex = vi.fn().mockRejectedValue(new Error('connection refused'));
    const collection = { createIndex } as unknown as Collection<IProcessingLogDocument>;
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ info: vi.fn() }),
    } as unknown as LoggerService;
    const initializer = new EnsureProcessingLogIndexesInitializer(collection, loggerService);

    await expect(initializer.onModuleInit()).rejects.toThrow('connection refused');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- ensure-processing-log-indexes-initializer.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ensure-processing-log-indexes-initializer.service.ts`**

`back-end/service-b/src/processing-log/ensure-processing-log-indexes-initializer.service.ts`:
```ts
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Collection } from 'mongodb';

import { ensureProcessingLogIndexes } from './ensure-processing-log-indexes.js';
import { PROCESSING_LOG_COLLECTION } from './processing-log-collection.provider.js';
import { type IProcessingLogDocument } from './processing-log.types.js';

@Injectable()
export class EnsureProcessingLogIndexesInitializer implements OnModuleInit {
  public constructor(
    @Inject(PROCESSING_LOG_COLLECTION) private readonly collection: Collection<IProcessingLogDocument>,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger('EnsureProcessingLogIndexesInitializer');
  }

  public async onModuleInit(): Promise<void> {
    await ensureProcessingLogIndexes(this.collection);

    this.logger.info({}, 'Ensured processing-logs collection indexes');
  }

  private readonly logger: AppLogger;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- ensure-processing-log-indexes-initializer.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-b/src/processing-log/ensure-processing-log-indexes-initializer.service.ts back-end/service-b/src/processing-log/ensure-processing-log-indexes-initializer.service.spec.ts
```

---

## Task 5: `service-b` — event → log-entry mappers

**Files:**
- Create: `back-end/service-b/src/processing-log/to-processing-log-entry.ts`
- Create: `back-end/service-b/src/processing-log/to-processing-log-entry.spec.ts`

**Interfaces:**
- Consumes: `type ImportStartedEvent`/`ImportCompletedEvent`/`ImportFailedEvent` (Phase 0,
  `@task1/shared/github-archive/index`), `type IProcessingLogDocument` (Task 3).
- Produces: `toStartedLogEntry(event: ImportStartedEvent, eventType: string): IProcessingLogDocument`,
  `toCompletedLogEntry(event: ImportCompletedEvent, eventType: string): IProcessingLogDocument`,
  `toFailedLogEntry(event: ImportFailedEvent, eventType: string): IProcessingLogDocument` — pure mapping
  functions, no I/O.
- Consumed by: Task 8 (`ImportEventsController`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-b/src/processing-log/to-processing-log-entry.spec.ts`:
```ts
import {
  type ImportCompletedEvent,
  type ImportFailedEvent,
  type ImportStartedEvent,
} from '@task1/shared/github-archive/index';

import { toCompletedLogEntry, toFailedLogEntry, toStartedLogEntry } from './to-processing-log-entry.js';

describe('toProcessingLogEntry', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const correlationId = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const archive = '2026-08-11-0.json.gz';

  describe('toStartedLogEntry', () => {
    it('should map a started event to a started log entry with empty metadata, when called', () => {
      const event: ImportStartedEvent = {
        importId,
        archive,
        startedAt: '2026-08-11T00:00:00.000Z',
        correlationId,
      };

      const result = toStartedLogEntry(event, 'github.import.started');

      expect(result).toEqual({
        importId,
        eventType: 'github.import.started',
        service: 'service-a',
        status: 'started',
        timestamp: new Date('2026-08-11T00:00:00.000Z'),
        correlationId,
        archive,
        metadata: {},
      });
    });
  });

  describe('toCompletedLogEntry', () => {
    it('should map a completed event to a completed log entry with the result counters as metadata, when called', () => {
      const event: ImportCompletedEvent = {
        importId,
        archive,
        startedAt: '2026-08-11T00:00:00.000Z',
        completedAt: '2026-08-11T00:05:00.000Z',
        eventsProcessed: 10,
        validEvents: 8,
        invalidEvents: 1,
        duplicateEvents: 1,
        errorCount: 0,
        correlationId,
      };

      const result = toCompletedLogEntry(event, 'github.import.completed');

      expect(result).toEqual({
        importId,
        eventType: 'github.import.completed',
        service: 'service-a',
        status: 'completed',
        timestamp: new Date('2026-08-11T00:05:00.000Z'),
        correlationId,
        archive,
        metadata: {
          eventsProcessed: 10,
          validEvents: 8,
          invalidEvents: 1,
          duplicateEvents: 1,
          errorCount: 0,
        },
      });
    });
  });

  describe('toFailedLogEntry', () => {
    it('should map a failed event to a failed log entry with errorInfo, when the reason is short', () => {
      const event: ImportFailedEvent = {
        importId,
        archive,
        startedAt: '2026-08-11T00:00:00.000Z',
        failedAt: '2026-08-11T00:02:00.000Z',
        reason: 'download failed: 404 Not Found',
        correlationId,
      };

      const result = toFailedLogEntry(event, 'github.import.failed');

      expect(result).toEqual({
        importId,
        eventType: 'github.import.failed',
        service: 'service-a',
        status: 'failed',
        timestamp: new Date('2026-08-11T00:02:00.000Z'),
        correlationId,
        archive,
        metadata: {},
        errorInfo: { reason: 'download failed: 404 Not Found' },
      });
    });

    it('should truncate the stored reason to 500 characters, when the reason is longer', () => {
      const longReason = 'x'.repeat(600);
      const event: ImportFailedEvent = {
        importId,
        archive,
        startedAt: '2026-08-11T00:00:00.000Z',
        failedAt: '2026-08-11T00:02:00.000Z',
        reason: longReason,
        correlationId,
      };

      const result = toFailedLogEntry(event, 'github.import.failed');

      expect(result.errorInfo).toEqual({ reason: longReason.slice(0, 500) });
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- to-processing-log-entry.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `to-processing-log-entry.ts`**

`back-end/service-b/src/processing-log/to-processing-log-entry.ts`:
```ts
import {
  type ImportCompletedEvent,
  type ImportFailedEvent,
  type ImportStartedEvent,
} from '@task1/shared/github-archive/index';

import { type IProcessingLogDocument } from './processing-log.types.js';

const ERROR_REASON_MAX_LENGTH = 500;

export function toStartedLogEntry(event: ImportStartedEvent, eventType: string): IProcessingLogDocument {
  return {
    importId: event.importId,
    eventType,
    service: 'service-a',
    status: 'started',
    timestamp: new Date(event.startedAt),
    correlationId: event.correlationId,
    archive: event.archive,
    metadata: {},
  };
}

export function toCompletedLogEntry(
  event: ImportCompletedEvent,
  eventType: string,
): IProcessingLogDocument {
  return {
    importId: event.importId,
    eventType,
    service: 'service-a',
    status: 'completed',
    timestamp: new Date(event.completedAt),
    correlationId: event.correlationId,
    archive: event.archive,
    metadata: {
      eventsProcessed: event.eventsProcessed,
      validEvents: event.validEvents,
      invalidEvents: event.invalidEvents,
      duplicateEvents: event.duplicateEvents,
      errorCount: event.errorCount,
    },
  };
}

export function toFailedLogEntry(event: ImportFailedEvent, eventType: string): IProcessingLogDocument {
  return {
    importId: event.importId,
    eventType,
    service: 'service-a',
    status: 'failed',
    timestamp: new Date(event.failedAt),
    correlationId: event.correlationId,
    archive: event.archive,
    metadata: {},
    errorInfo: { reason: event.reason.slice(0, ERROR_REASON_MAX_LENGTH) },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- to-processing-log-entry.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-b/src/processing-log/to-processing-log-entry.ts back-end/service-b/src/processing-log/to-processing-log-entry.spec.ts
```

---

## Task 6: `service-b` — `ProcessingLogTracker`

**Files:**
- Create: `back-end/service-b/src/processing-log/processing-log-tracker.service.ts`
- Create: `back-end/service-b/src/processing-log/processing-log-tracker.service.spec.ts`

**Interfaces:**
- Consumes: `PROCESSING_LOG_COLLECTION` (Task 3), `type IProcessingLogDocument` (Task 3).
- Produces: `ProcessingLogTracker.upsertLog(entry: IProcessingLogDocument): Promise<void>` — upserts
  keyed by `{importId, status}`.
- Consumed by: Task 8 (`ImportEventsController`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-b/src/processing-log/processing-log-tracker.service.spec.ts`:
```ts
import { type Collection } from 'mongodb';

import { ProcessingLogTracker } from './processing-log-tracker.service.js';
import { type IProcessingLogDocument } from './processing-log.types.js';

describe('ProcessingLogTracker', () => {
  const entry: IProcessingLogDocument = {
    importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    eventType: 'github.import.started',
    service: 'service-a',
    status: 'started',
    timestamp: new Date('2026-08-11T00:00:00.000Z'),
    correlationId: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    archive: '2026-08-11-0.json.gz',
    metadata: {},
  };

  function buildTracker(updateOne: ReturnType<typeof vi.fn>): ProcessingLogTracker {
    const collection = { updateOne } as unknown as Collection<IProcessingLogDocument>;

    return new ProcessingLogTracker(collection);
  }

  describe('upsertLog', () => {
    it('should upsert keyed by importId and status, when called', async () => {
      const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
      const tracker = buildTracker(updateOne);

      await tracker.upsertLog(entry);

      expect(updateOne).toHaveBeenCalledWith(
        { importId: entry.importId, status: entry.status },
        { $set: entry },
        { upsert: true },
      );
    });

    it('should issue the identical upsert, when called twice with the same entry (redelivery is a no-op)', async () => {
      const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
      const tracker = buildTracker(updateOne);

      await tracker.upsertLog(entry);
      await tracker.upsertLog(entry);

      expect(updateOne).toHaveBeenCalledTimes(2);
      expect(updateOne.mock.calls[0]).toEqual(updateOne.mock.calls[1]);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- processing-log-tracker.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `processing-log-tracker.service.ts`**

`back-end/service-b/src/processing-log/processing-log-tracker.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { type Collection } from 'mongodb';

import { PROCESSING_LOG_COLLECTION } from './processing-log-collection.provider.js';
import { type IProcessingLogDocument } from './processing-log.types.js';

@Injectable()
export class ProcessingLogTracker {
  public constructor(
    @Inject(PROCESSING_LOG_COLLECTION)
    private readonly collection: Collection<IProcessingLogDocument>,
  ) {}

  public async upsertLog(entry: IProcessingLogDocument): Promise<void> {
    await this.collection.updateOne(
      { importId: entry.importId, status: entry.status },
      { $set: entry },
      { upsert: true },
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- processing-log-tracker.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-b/src/processing-log/processing-log-tracker.service.ts back-end/service-b/src/processing-log/processing-log-tracker.service.spec.ts
```

---

## Task 7: `service-b` — retry/dead-letter header util

**Files:**
- Create: `back-end/service-b/src/processing-log/retry-count.util.ts`
- Create: `back-end/service-b/src/processing-log/retry-count.util.spec.ts`

**Interfaces:**
- Produces: `RETRY_COUNT_HEADER` (`'x-retry-count'`), `IRmqMessage { content: Buffer; properties: {
  headers?: Record<string, unknown> } }` (the local, minimally-typed shape this module needs from
  `RmqContext.getMessage()`'s loosely-typed `Record<string, any>` return — matching the existing
  `RmqContextInterceptor`'s own precedent of declaring a small local interface rather than trusting
  `any`), `getRetryCount(message: IRmqMessage): number` (defaults to `0` when the header is absent or not
  a positive finite number), `buildRetryHeaders(message: IRmqMessage, retryCount: number):
  Record<string, unknown>` (merges the message's existing headers with the new count).
- Consumed by: Task 8 (`ImportEventsController`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-b/src/processing-log/retry-count.util.spec.ts`:
```ts
import { buildRetryHeaders, getRetryCount, type IRmqMessage } from './retry-count.util.js';

describe('retryCountUtil', () => {
  describe('getRetryCount', () => {
    it('should return 0, when the message has no headers', () => {
      const message: IRmqMessage = { content: Buffer.from('{}'), properties: {} };

      expect(getRetryCount(message)).toBe(0);
    });

    it('should return 0, when the retry-count header is absent', () => {
      const message: IRmqMessage = { content: Buffer.from('{}'), properties: { headers: {} } };

      expect(getRetryCount(message)).toBe(0);
    });

    it('should return the parsed count, when the retry-count header is present', () => {
      const message: IRmqMessage = {
        content: Buffer.from('{}'),
        properties: { headers: { 'x-retry-count': 3 } },
      };

      expect(getRetryCount(message)).toBe(3);
    });

    it('should return 0, when the retry-count header is not a positive number', () => {
      const message: IRmqMessage = {
        content: Buffer.from('{}'),
        properties: { headers: { 'x-retry-count': 'not-a-number' } },
      };

      expect(getRetryCount(message)).toBe(0);
    });
  });

  describe('buildRetryHeaders', () => {
    it('should merge existing headers with the new retry count, when called', () => {
      const message: IRmqMessage = {
        content: Buffer.from('{}'),
        properties: { headers: { 'x-request-id': 'abc' } },
      };

      expect(buildRetryHeaders(message, 2)).toEqual({ 'x-request-id': 'abc', 'x-retry-count': 2 });
    });

    it('should return only the retry count, when the message has no existing headers', () => {
      const message: IRmqMessage = { content: Buffer.from('{}'), properties: {} };

      expect(buildRetryHeaders(message, 1)).toEqual({ 'x-retry-count': 1 });
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- retry-count.util.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `retry-count.util.ts`**

`back-end/service-b/src/processing-log/retry-count.util.ts`:
```ts
export const RETRY_COUNT_HEADER = 'x-retry-count';

export interface IRmqMessage {
  content: Buffer;
  properties: { headers?: Record<string, unknown> };
}

export function getRetryCount(message: IRmqMessage): number {
  // eslint-disable-next-line security/detect-object-injection -- RETRY_COUNT_HEADER is a fixed literal, not user input.
  const header = message.properties.headers?.[RETRY_COUNT_HEADER];
  const parsed = Number(header);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function buildRetryHeaders(message: IRmqMessage, retryCount: number): Record<string, unknown> {
  return { ...message.properties.headers, [RETRY_COUNT_HEADER]: retryCount };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- retry-count.util.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-b/src/processing-log/retry-count.util.ts back-end/service-b/src/processing-log/retry-count.util.spec.ts
```

---

## Task 8: `service-b` — `ImportEventsController`

**Files:**
- Create: `back-end/service-b/src/processing-log/import-events.controller.ts`
- Create: `back-end/service-b/src/processing-log/import-events.controller.spec.ts`

**Interfaces:**
- Consumes: `EVENT_PATTERNS`, `importStartedEventSchema`/`importCompletedEventSchema`/
  `importFailedEventSchema`, `type ImportStartedEvent`/`ImportCompletedEvent`/`ImportFailedEvent` (Phase
  0, `@task1/shared/github-archive/index`), `rabbitmqConfig`/`type RabbitmqConfiguration` (Task 1),
  `ProcessingLogTracker.upsertLog` (Task 6), `toStartedLogEntry`/`toCompletedLogEntry`/`toFailedLogEntry`
  (Task 5), `getRetryCount`/`buildRetryHeaders`/`type IRmqMessage` (Task 7).
- Produces: `ImportEventsController` with three `@EventPattern` handlers
  (`handleImportStarted`/`handleImportCompleted`/`handleImportFailed`), each delegating to one private
  `processEvent` method so the ack/retry/dead-letter mechanics exist once.
- Consumed by: Task 9 (`ProcessingLogModule` controllers).

- [ ] **Step 1: Write the failing tests**

`back-end/service-b/src/processing-log/import-events.controller.spec.ts`:
```ts
import { type RmqContext } from '@nestjs/microservices';
import {
  EVENT_PATTERNS,
  type ImportCompletedEvent,
  type ImportFailedEvent,
  type ImportStartedEvent,
} from '@task1/shared/github-archive/index';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';

import { type RabbitmqConfiguration } from '../config/rabbitmq.config.js';

import { ImportEventsController } from './import-events.controller.js';
import { ProcessingLogTracker } from './processing-log-tracker.service.js';
import { type IProcessingLogDocument } from './processing-log.types.js';

describe('ImportEventsController', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const correlationId = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const archive = '2026-08-11-0.json.gz';
  const rabbitmqConfiguration: RabbitmqConfiguration = {
    url: 'amqp://guest:guest@localhost:5672',
    queue: 'service_b_queue',
    prefetchCount: 10,
    maxRetries: 5,
    deadLetterQueue: 'service_b_queue.dlq',
  };

  function buildController(upsertLog: ReturnType<typeof vi.fn>): ImportEventsController {
    const tracker = { upsertLog } as unknown as ProcessingLogTracker;
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ warn: vi.fn(), error: vi.fn() }),
    } as unknown as LoggerService;

    return new ImportEventsController(tracker, rabbitmqConfiguration, loggerService);
  }

  function buildContext(headers: Record<string, unknown> = {}): {
    context: RmqContext;
    message: { content: Buffer; properties: { headers: Record<string, unknown> } };
    ack: ReturnType<typeof vi.fn>;
    sendToQueue: ReturnType<typeof vi.fn>;
    assertQueue: ReturnType<typeof vi.fn>;
  } {
    const message = { content: Buffer.from('payload'), properties: { headers } };
    const ack = vi.fn();
    const sendToQueue = vi.fn();
    const assertQueue = vi.fn().mockResolvedValue(undefined);
    const context = {
      getChannelRef: vi.fn().mockReturnValue({ ack, sendToQueue, assertQueue }),
      getMessage: vi.fn().mockReturnValue(message),
    } as unknown as RmqContext;

    return { context, message, ack, sendToQueue, assertQueue };
  }

  describe('handleImportStarted', () => {
    const validPayload: ImportStartedEvent = {
      importId,
      archive,
      startedAt: '2026-08-11T00:00:00.000Z',
      correlationId,
    };

    it('should upsert a started log entry and ack the message, when the payload is valid', async () => {
      const upsertLog = vi.fn().mockResolvedValue(undefined);
      const controller = buildController(upsertLog);
      const { context, message, ack, sendToQueue } = buildContext();

      await controller.handleImportStarted(validPayload, context);

      const expectedEntry: IProcessingLogDocument = {
        importId,
        eventType: EVENT_PATTERNS.IMPORT_STARTED,
        service: 'service-a',
        status: 'started',
        timestamp: new Date(validPayload.startedAt),
        correlationId,
        archive,
        metadata: {},
      };

      expect(upsertLog).toHaveBeenCalledWith(expectedEntry);
      expect(ack).toHaveBeenCalledWith(message);
      expect(sendToQueue).not.toHaveBeenCalled();
    });

    it('should ack the message without upserting, when the payload fails validation', async () => {
      const upsertLog = vi.fn();
      const controller = buildController(upsertLog);
      const { context, message, ack } = buildContext();

      await controller.handleImportStarted({ importId: 'not-a-uuid' }, context);

      expect(upsertLog).not.toHaveBeenCalled();
      expect(ack).toHaveBeenCalledWith(message);
    });

    it('should republish to the same queue with an incremented retry header and ack the original, when the repository write fails below maxRetries', async () => {
      const upsertLog = vi.fn().mockRejectedValue(new Error('connection refused'));
      const controller = buildController(upsertLog);
      const { context, message, ack, sendToQueue, assertQueue } = buildContext({ 'x-retry-count': 2 });

      await controller.handleImportStarted(validPayload, context);

      expect(sendToQueue).toHaveBeenCalledWith('service_b_queue', message.content, {
        headers: { 'x-retry-count': 3 },
      });
      expect(assertQueue).not.toHaveBeenCalled();
      expect(ack).toHaveBeenCalledWith(message);
    });

    it('should dead-letter the message and ack the original, when the repository write fails at maxRetries', async () => {
      const upsertLog = vi.fn().mockRejectedValue(new Error('connection refused'));
      const controller = buildController(upsertLog);
      const { context, message, ack, sendToQueue, assertQueue } = buildContext({ 'x-retry-count': 5 });

      await controller.handleImportStarted(validPayload, context);

      expect(assertQueue).toHaveBeenCalledWith('service_b_queue.dlq', { durable: true });
      expect(sendToQueue).toHaveBeenCalledWith('service_b_queue.dlq', message.content, {
        headers: { 'x-retry-count': 6 },
      });
      expect(ack).toHaveBeenCalledWith(message);
    });
  });

  describe('handleImportCompleted', () => {
    it('should upsert a completed log entry with the result counters as metadata and ack the message, when the payload is valid', async () => {
      const upsertLog = vi.fn().mockResolvedValue(undefined);
      const controller = buildController(upsertLog);
      const { context, message, ack } = buildContext();
      const validPayload: ImportCompletedEvent = {
        importId,
        archive,
        startedAt: '2026-08-11T00:00:00.000Z',
        completedAt: '2026-08-11T00:05:00.000Z',
        eventsProcessed: 10,
        validEvents: 8,
        invalidEvents: 1,
        duplicateEvents: 1,
        errorCount: 0,
        correlationId,
      };

      await controller.handleImportCompleted(validPayload, context);

      expect(upsertLog).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed',
          metadata: {
            eventsProcessed: 10,
            validEvents: 8,
            invalidEvents: 1,
            duplicateEvents: 1,
            errorCount: 0,
          },
        }),
      );
      expect(ack).toHaveBeenCalledWith(message);
    });
  });

  describe('handleImportFailed', () => {
    it('should upsert a failed log entry with errorInfo and ack the message, when the payload is valid', async () => {
      const upsertLog = vi.fn().mockResolvedValue(undefined);
      const controller = buildController(upsertLog);
      const { context, message, ack } = buildContext();
      const validPayload: ImportFailedEvent = {
        importId,
        archive,
        startedAt: '2026-08-11T00:00:00.000Z',
        failedAt: '2026-08-11T00:02:00.000Z',
        reason: 'download failed: 404 Not Found',
        correlationId,
      };

      await controller.handleImportFailed(validPayload, context);

      expect(upsertLog).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          errorInfo: { reason: 'download failed: 404 Not Found' },
        }),
      );
      expect(ack).toHaveBeenCalledWith(message);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- import-events.controller.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `import-events.controller.ts`**

`back-end/service-b/src/processing-log/import-events.controller.ts`:
```ts
import { Controller, Inject } from '@nestjs/common';
import { Ctx, EventPattern, Payload, type RmqContext } from '@nestjs/microservices';
import {
  EVENT_PATTERNS,
  importCompletedEventSchema,
  importFailedEventSchema,
  importStartedEventSchema,
  type ImportCompletedEvent,
  type ImportFailedEvent,
  type ImportStartedEvent,
} from '@task1/shared/github-archive/index';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type ZodType } from 'zod';

import rabbitmqConfig, { type RabbitmqConfiguration } from '../config/rabbitmq.config.js';

import { ProcessingLogTracker } from './processing-log-tracker.service.js';
import { type IProcessingLogDocument } from './processing-log.types.js';
import { buildRetryHeaders, getRetryCount, type IRmqMessage } from './retry-count.util.js';
import { toCompletedLogEntry, toFailedLogEntry, toStartedLogEntry } from './to-processing-log-entry.js';

interface IRmqChannel {
  ack(message: IRmqMessage): void;
  sendToQueue(queue: string, content: Buffer, options?: { headers?: Record<string, unknown> }): boolean;
  assertQueue(queue: string, options?: { durable?: boolean }): Promise<unknown>;
}

const MALFORMED_MESSAGE_LOG = 'Rejected malformed import event, acking without storing';
const RETRY_SCHEDULED_LOG = 'Processing-log write failed, republishing with an incremented retry count';
const DEAD_LETTERED_LOG = 'Processing-log write failed at maxRetries, moving message to the dead-letter queue';

@Controller()
export class ImportEventsController {
  public constructor(
    private readonly tracker: ProcessingLogTracker,
    @Inject(rabbitmqConfig.KEY) private readonly rabbitmqConfiguration: RabbitmqConfiguration,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger('ImportEventsController');
  }

  @EventPattern(EVENT_PATTERNS.IMPORT_STARTED)
  public handleImportStarted(@Payload() payload: unknown, @Ctx() context: RmqContext): Promise<void> {
    return this.processEvent(
      EVENT_PATTERNS.IMPORT_STARTED,
      importStartedEventSchema,
      toStartedLogEntry,
      payload,
      context,
    );
  }

  @EventPattern(EVENT_PATTERNS.IMPORT_COMPLETED)
  public handleImportCompleted(@Payload() payload: unknown, @Ctx() context: RmqContext): Promise<void> {
    return this.processEvent(
      EVENT_PATTERNS.IMPORT_COMPLETED,
      importCompletedEventSchema,
      toCompletedLogEntry,
      payload,
      context,
    );
  }

  @EventPattern(EVENT_PATTERNS.IMPORT_FAILED)
  public handleImportFailed(@Payload() payload: unknown, @Ctx() context: RmqContext): Promise<void> {
    return this.processEvent(
      EVENT_PATTERNS.IMPORT_FAILED,
      importFailedEventSchema,
      toFailedLogEntry,
      payload,
      context,
    );
  }

  private async processEvent<TEvent extends ImportStartedEvent | ImportCompletedEvent | ImportFailedEvent>(
    eventType: string,
    schema: ZodType<TEvent>,
    toEntry: (event: TEvent, eventType: string) => IProcessingLogDocument,
    payload: unknown,
    context: RmqContext,
  ): Promise<void> {
    const channel = context.getChannelRef() as IRmqChannel;
    const message = context.getMessage() as IRmqMessage;

    const parseResult = schema.safeParse(payload);

    if (!parseResult.success) {
      this.logger.warn({ eventType, error: parseResult.error.message }, MALFORMED_MESSAGE_LOG);
      channel.ack(message);

      return;
    }

    try {
      await this.tracker.upsertLog(toEntry(parseResult.data, eventType));
      channel.ack(message);
    } catch (error) {
      await this.retryOrDeadLetter(channel, message, eventType, error);
    }
  }

  private async retryOrDeadLetter(
    channel: IRmqChannel,
    message: IRmqMessage,
    eventType: string,
    error: unknown,
  ): Promise<void> {
    const retryCount = getRetryCount(message) + 1;
    const headers = buildRetryHeaders(message, retryCount);
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (retryCount > this.rabbitmqConfiguration.maxRetries) {
      await channel.assertQueue(this.rabbitmqConfiguration.deadLetterQueue, { durable: true });
      channel.sendToQueue(this.rabbitmqConfiguration.deadLetterQueue, message.content, { headers });
      this.logger.error({ eventType, retryCount, error: errorMessage }, DEAD_LETTERED_LOG);
    } else {
      channel.sendToQueue(this.rabbitmqConfiguration.queue, message.content, { headers });
      this.logger.warn({ eventType, retryCount, error: errorMessage }, RETRY_SCHEDULED_LOG);
    }

    channel.ack(message);
  }

  private readonly logger: AppLogger;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- import-events.controller.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-b/src/processing-log/import-events.controller.ts back-end/service-b/src/processing-log/import-events.controller.spec.ts
```

---

## Task 9: `service-b` — `ProcessingLogModule` wiring

**Files:**
- Create: `back-end/service-b/src/processing-log/processing-log.module.ts`
- Modify: `back-end/service-b/src/app.module.ts`

**Interfaces:**
- Consumes: every provider/controller from Tasks 3–8.
- Produces: `ProcessingLogModule` — mirrors `ArchiveModule`'s shape (controllers + providers, no
  `ClientsModule` needed since this service never emits, it only consumes).
- Consumed by: `AppModule`.

- [ ] **Step 1: Implement `processing-log.module.ts`**

`back-end/service-b/src/processing-log/processing-log.module.ts`:
```ts
import { Module } from '@nestjs/common';

import { EnsureProcessingLogIndexesInitializer } from './ensure-processing-log-indexes-initializer.service.js';
import { ImportEventsController } from './import-events.controller.js';
import { processingLogCollectionProvider } from './processing-log-collection.provider.js';
import { ProcessingLogTracker } from './processing-log-tracker.service.js';

@Module({
  controllers: [ImportEventsController],
  providers: [processingLogCollectionProvider, EnsureProcessingLogIndexesInitializer, ProcessingLogTracker],
})
export class ProcessingLogModule {}
```

- [ ] **Step 2: Register the module on `AppModule`**

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
import { ProcessingLogModule } from './processing-log/processing-log.module.js';

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
    ProcessingLogModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 3: Run the full `service-b` test suite (with coverage) and lint**

Run: `pnpm --filter service-b test -- --coverage && pnpm --filter service-b lint`
Expected: both PASS; coverage stays at or above 90% lines / 90% branches.

- [ ] **Step 4: Manual smoke check against the real stack**

Run: `docker compose up -d rabbitmq mongo redis && pnpm --filter service-b start:dev`, then (in another
terminal) trigger a Phase-5 import (`POST /v1/imports` via the gateway, or replay a known
`archive.import.download` message) and confirm via `docker compose logs service-b` that "Ensured
processing-logs collection indexes" logs at boot and that no unacked-message warnings appear as the three
lifecycle events arrive. This step has no automated assertion — it's the same kind of manual,
documented-not-asserted verification Phase 0 used for its own infra bootstrap.

- [ ] **Step 5: Stage the files**

```bash
git add back-end/service-b/src/processing-log/processing-log.module.ts back-end/service-b/src/app.module.ts
```

---

## Self-Review

**Spec coverage:** every element of the design doc's "Service-b: RabbitMQ consumer & processing-log
storage (Phase 6)" section maps to a task above — three `@EventPattern` handlers validating via the
shared Zod contracts (Task 8), upsert keyed by `{importId, status}` with a unique index (Tasks 3, 6),
manual ack (Tasks 2, 8), bounded retry before dead-lettering (Tasks 7, 8), bounded consumer concurrency
via `prefetchCount` (Tasks 1, 2), and the exact stored log fields the design doc lists — `eventType`,
`service: 'service-a'`, `timestamp`, `correlationId`, `importId`, `archive`, `status`, `metadata`,
`errorInfo?` (Task 3's `IProcessingLogDocument`, Task 5's mappers).

**Placeholder scan:** no TBD/TODO; every step shows complete, runnable code and a concrete test/command
with an expected result.

**Type/name consistency across tasks:** `IProcessingLogDocument` (Task 3) is the exact shape Task 5's
mappers return, Task 6's `ProcessingLogTracker.upsertLog` accepts, and Task 8's tests assert against.
`RabbitmqConfiguration` (Task 1, with `prefetchCount`/`maxRetries`/`deadLetterQueue`) is reused unchanged
by Task 2's `main.ts` and Task 8's `ImportEventsController`. `IRmqMessage`/`getRetryCount`/
`buildRetryHeaders` (Task 7) are reused unchanged by Task 8. `PROCESSING_LOG_COLLECTION` (Task 3) is
reused unchanged by Tasks 4 and 6.
