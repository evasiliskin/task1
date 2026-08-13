# Phase 8: Service-b Processing Statistics API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /v1/stats?importId=...` (gateway) — processing statistics computed from the `processing-logs`
documents `service-b` already stores (Phase 6), either scoped to one import or aggregated across all
imports when `importId` is omitted. Status/counter totals come from a MongoDB aggregation
(`$match` + `$group by status`, summing `metadata` counters) — never by loading raw historical logs into
Node. A processing-duration figure and a downsampled events-processed time series are layered on top: for
the aggregate (no-`importId`) case they come from `TS.RANGE` reads against the RedisTimeSeries keys
`service-a`'s import pipeline already writes (Phase 5); for a single scoped import (where those keys have
no per-import granularity) they're derived directly from that import's own `started`/`completed`
`processing-logs` documents — at most 3 documents, fetched once, never a bulk scan.

**Architecture:** A new `back-end/service-b/src/processing-log/stats/` subfolder (mirroring Phase 7's
`processing-log/search/` layout — stats reads the *same* `processing-logs` collection Phase 6/7 already
own, so this stays inside `ProcessingLogModule` rather than becoming a new top-level module, per
`CLAUDE.md`'s "Database access belongs only to the owning module" rule) holds the pure step functions —
`build-stats-pipeline.ts` (aggregation pipeline builder), `shape-stats.ts` (groups → counters),
`derive-import-duration-stats.ts` (single-import duration/time-series from raw documents),
`get-stats-message.schema.ts` (Zod validation for the inbound RMQ payload) — plus `StatsMetricsReader`
(injectable Redis reader, mirrors service-a's `MetricsService` shape but for reads), `get-stats.ts`
(orchestration), `StatsService` (DI wrapper), and `StatsController` (`@MessagePattern('stats.get')`), all
added to the existing `ProcessingLogModule`. On the gateway side, a new `back-end/api-gateway/src/stats/`
module owns `GET /stats`: a class-validator `GetStatsQueryDto`, a module-scoped `SERVICE_B_RMQ_CLIENT`
(the same per-module-duplication pattern `LogsModule`/`EventsModule` already use), and a `StatsController`
that calls `ClientProxy.send()` with an `RmqRecordBuilder`-wrapped payload, exactly like `LogsController`.

**Tech Stack:** `@nestjs/microservices` (`ClientProxy.send`, `@MessagePattern`, `@Ctx`, `RmqContext`), Zod
(service-b inbound message validation), `class-validator`/`class-transformer` (gateway query DTO), official
`mongodb` driver v7 (`Collection.aggregate().toArray()`, `Collection.find().toArray()`), `ioredis`
(`.call('TS.RANGE', ...)`), Vitest.

**Design doc:** `docs/superpowers/specs/2026-08-12-github-archive-platform-design.md` (section "Service-b:
processing statistics API (Phase 8)").
**Roadmap:** `docs/superpowers/plans/2026-08-12-github-archive-platform-plan.md` (Phase 8 of 11) — produces
`StatsResult { archivesProcessed, eventsProcessed, successfulEvents, invalidEvents, processingDurationMs,
errors }` plus a `timeSeries` field, reused as-is by Phase 9's PDF report.
**Depends on:** Phase 6 (`IProcessingLogDocument`/`ProcessingLogStatus`, `PROCESSING_LOG_COLLECTION`,
`ProcessingLogModule`), Phase 5 (the RedisTimeSeries metric keys `service-a` writes:
`service_a.archive.processing.duration`, `service_a.archive.events.processed` — verified in
`back-end/service-a/src/archive/import-archive.ts`), Phase 4/7 (the gateway's per-module RMQ-client +
Swagger-decorated-`GET`-controller pattern this phase's `StatsModule`/`StatsController` mirror).

Every file path, existing convention, and framework detail below was verified by reading this exact
repository's current state (post-Phase-7) before this plan was written, including confirming that
`MONGO_CLIENT` and `REDIS_CLIENT` are both `@Global()`-scoped in `service-b` (so no new provider wiring is
needed to reach them from inside `ProcessingLogModule`), and that `service-b`'s `redis.config.ts` is
currently missing the `metricsRetentionMs` field `service-a`'s already has (Task 1 adds it).

## Global Constraints

- **Finding 1 — the RedisTimeSeries metric keys `service-a` writes are process-wide, not per-import.**
  `service_a.archive.processing.duration` and `service_a.archive.events.processed` (see
  `back-end/service-a/src/archive/import-archive.ts`) accumulate one sample per import run across *every*
  import, with no `importId` tag. So `TS.RANGE` reads against them only make sense for the aggregate
  (`importId` omitted) view. When `importId` is provided, `processingDurationMs` and `timeSeries` are
  instead derived directly from that one import's own `started`/`completed` `processing-logs` documents (a
  bounded, at-most-3-document `find()` — not a Redis read at all). This is why `getStats` (Task 6) branches
  on `importId` rather than always going to Redis.
- **Finding 2 — `service-b`'s `redis.config.ts` lacks `metricsRetentionMs`.** `service-a`'s schema already
  has it (used by `MetricsService` to set `TS.ADD ... RETENTION`); `service-b` needs the same value to know
  how far back `TS.RANGE` can usefully read and to size its downsample bucket. Task 1 adds it with the
  identical default (`604_800_000`, 7 days) and env var name pattern, so both services agree on the
  retention window without either hardcoding the other's value.
- **`errors` composition is deliberately defined as `(failed-import count) + (sum of `metadata.errorCount`
  across completed imports)`.** A `processing-logs` document's `status: 'failed'` means the whole import
  run failed (see Phase 6's `toFailedLogEntry`); `metadata.errorCount` on a `status: 'completed'` document
  counts NDJSON lines that failed validation *within* an otherwise-successful import (Phase 2's
  `ImportResult.errorCount`). Both are "errors" in the everyday sense the stats endpoint reports, so
  `shapeStats` (Task 3) sums them into one field rather than inventing a two-field shape the design doc
  doesn't ask for.
- **`archivesProcessed` counts only `status: 'completed'` documents** — a failed import never finished
  processing an archive, so it doesn't count as one "processed", even though a `processing-logs` document
  exists for it.
- **This phase does not run `ensureProcessingLogIndexes` again** — the aggregation's `$match` (on
  `importId` when provided) already hits the `{importId:1, timestamp:-1}` index Phase 7 created; the
  `$group` stage itself is a full scan of the (small, `$match`-narrowed) matched set, which is the accepted
  cost of any aggregation and not something an index removes.
- **Never throw raw `Error`.** No new `AppError` subclass is needed this phase — `getStatsMessageSchema`'s
  `.parse()` failures propagate as a `ZodError`, exactly like Phase 7's `searchLogsMessageSchema`, and are
  normalized by the `ExceptionHandlingModule`'s `RpcAppExceptionFilter` already wired into `service-b`'s
  `app.module.ts` (no per-controller filter needed, matching every other RMQ controller in this codebase).
- **`StatsController` (service-b) runs under `noAck: false`, so it acks in a `finally` block**, identical
  to Phase 7's `LogsSearchController.handleSearch` — `service-b`'s `main.ts` was switched to manual ack in
  Phase 6 and every `@MessagePattern` handler on that microservice must ack itself.
- **`StatsMetricsReader` swallows Redis failures and returns a safe fallback** (`undefined` for the
  duration, `[]` for the time series), logging a warning — never throwing, never failing the whole stats
  response. This matches the design doc's explicit "a metrics failure (Redis unavailable) is logged and
  swallowed, never allowed to fail the primary operation" rule, extended here from writes (Phase 5's
  `MetricsService.recordMetric`) to reads.
- **`StatsService`/`StatsController`/`StatsMetricsReader` are registered as providers/controllers of the
  existing `ProcessingLogModule`**, not a new top-level `service-b` module — they read the same
  `processing-logs` collection Phase 6/7 already own, and `CLAUDE.md`'s module-boundary rule ("Database
  access belongs only to the owning module") means that collection's access stays inside the module that
  owns it. The **gateway's** `StatsModule` is a new top-level module, same as `LogsModule`/`EventsModule`
  — the gateway has no persistence to own, so each of its feature areas is its own thin HTTP-to-RMQ module.
- `StatsModule` (gateway) registers its **own** `SERVICE_B_RMQ_CLIENT` via `ClientsModule.registerAsync`,
  under its own `stats/rabbitmq-client.token.ts` — the same module-scoped duplication `LogsModule`,
  `EventsModule`, `HealthModule`, and `ImportsModule` already use (string DI tokens are module-scoped, so
  the identical `'SERVICE_B_RMQ_CLIENT'` string across modules does not collide). Consolidating these is a
  cross-cutting refactor of existing working code, out of scope here (`CLAUDE.md`'s "no unrelated
  refactoring") — already called out as an accepted trade-off in Phase 7's plan.
- Zod validates the inbound RMQ message shape (`get-stats-message.schema.ts`); `class-validator`/
  `class-transformer` validate the gateway's HTTP query params (`GetStatsQueryDto`) — each service keeps
  using the validation library already established at its own boundary.
- `unicorn/prevent-abbreviations` rejects short names — full words throughout (allowlist:
  `Dto`/`dto`/`req`/`res`/`E2e`/`e2e`, per `eslint.config.mjs`; `Ms`/`ms` suffixes are already used
  repo-wide for millisecond fields — `rpcTimeoutMs`, `pingTimeoutMs`, `metricsRetentionMs` — and are not
  flagged).
- Type-only imports use inline `type` modifiers; relative imports use explicit `.js` extensions; imports
  grouped (builtin/external/internal/parent/sibling/index), alphabetized ascending case-insensitive, blank
  line between groups.
- Naming: `interface`s are `PascalCase` prefixed with `I` (`IStatsGroup`, `IStatsView`). `type` aliases are
  `PascalCase` with no prefix (`GetStatsMessage`). Blank line required before every `return`/`throw`
  following a statement, and before every `if`.
- `vitest` globals (`describe`/`it`/`expect`/`vi`/`beforeAll`/`beforeEach`/`afterAll`/`afterEach`) are
  available without import (`vitest.config.ts` sets `globals: true`) — do NOT import them in spec files.
- BDD test naming: `it('should X, when Y')`. Coverage thresholds: 90% lines, 90% branches.
- Mocking convention: plain object literal matching only the members under test, cast with
  `as unknown as <RealType>` — never `vi.mock()`. Direct class instantiation (`new X(...)`) over
  `Test.createTestingModule()` when Nest DI is not itself under test (gateway integration tests are the
  exception — they use `Test.createTestingModule()` + `supertest`).
- Real UUID-shaped literals in test fixtures: `a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11` (importId),
  `b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11` (correlationId), reusing Phase 5/6/7's literals.
- No `git commit` in any step — every checkpoint is written as "stage the files"; the user commits.

---

## Task 1: `service-b` — add `metricsRetentionMs` to `redis.config.ts`

**Files:**
- Modify: `back-end/service-b/src/config/redis.config.ts`
- Modify: `back-end/service-b/src/config/redis.config.spec.ts`

**Interfaces:**
- Produces: `RedisConfiguration { url: string; metricsRetentionMs: number }` — new field, default
  `604_800_000` (7 days, identical to `service-a`'s schema), overridable via `REDIS_METRICS_RETENTION_MS`.
- Consumed by: Task 5 (`StatsMetricsReader`).

- [ ] **Step 1: Replace the spec with assertions covering the new field**

Replace the full contents of `back-end/service-b/src/config/redis.config.spec.ts`:
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

      expect(redisConfig()).toEqual({
        url: 'redis://localhost:6379',
        metricsRetentionMs: 604_800_000,
      });
    });
  });

  describe('environment overrides', () => {
    it('should parse values from environment variables, when all variables are set', () => {
      process.env.REDIS_URL = 'redis://redis-host:6379';
      process.env.REDIS_METRICS_RETENTION_MS = '3600000';

      expect(redisConfig()).toEqual({
        url: 'redis://redis-host:6379',
        metricsRetentionMs: 3_600_000,
      });
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

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `pnpm --filter service-b test -- redis.config.spec.ts`
Expected: FAIL — `metricsRetentionMs` is not yet in the schema, so it's `undefined` in the actual output.

- [ ] **Step 3: Add `metricsRetentionMs` to the schema**

Replace the full contents of `back-end/service-b/src/config/redis.config.ts`:
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter service-b test -- redis.config.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-b/src/config/redis.config.ts back-end/service-b/src/config/redis.config.spec.ts
```

---

## Task 2: `service-b` — `buildStatsPipeline` aggregation-pipeline builder

**Files:**
- Create: `back-end/service-b/src/processing-log/stats/build-stats-pipeline.ts`
- Create: `back-end/service-b/src/processing-log/stats/build-stats-pipeline.spec.ts`

**Interfaces:**
- Produces: `buildStatsPipeline(importId?: string): Document[]` — pure function. `$match`es on `importId`
  when given (otherwise matches every document), then `$group`s by `status`, summing `metadata`'s five
  numeric counters plus a per-group document `count`.
- Consumed by: Task 6 (`get-stats.ts`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-b/src/processing-log/stats/build-stats-pipeline.spec.ts`:
```ts
import { buildStatsPipeline } from './build-stats-pipeline.js';

describe('buildStatsPipeline', () => {
  const expectedGroupStage = {
    $group: {
      _id: '$status',
      count: { $sum: 1 },
      eventsProcessed: { $sum: '$metadata.eventsProcessed' },
      validEvents: { $sum: '$metadata.validEvents' },
      invalidEvents: { $sum: '$metadata.invalidEvents' },
      errorCount: { $sum: '$metadata.errorCount' },
    },
  };

  it('should match every document and group by status, when importId is omitted', () => {
    expect(buildStatsPipeline()).toEqual([{ $match: {} }, expectedGroupStage]);
  });

  it('should match only the given importId, when importId is provided', () => {
    const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

    expect(buildStatsPipeline(importId)).toEqual([{ $match: { importId } }, expectedGroupStage]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- build-stats-pipeline.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `build-stats-pipeline.ts`**

`back-end/service-b/src/processing-log/stats/build-stats-pipeline.ts`:
```ts
import { type Document, type Filter } from 'mongodb';

import { type IProcessingLogDocument } from '../processing-log.types.js';

export function buildStatsPipeline(importId?: string): Document[] {
  const match: Filter<IProcessingLogDocument> = importId === undefined ? {} : { importId };

  return [
    { $match: match },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        eventsProcessed: { $sum: '$metadata.eventsProcessed' },
        validEvents: { $sum: '$metadata.validEvents' },
        invalidEvents: { $sum: '$metadata.invalidEvents' },
        errorCount: { $sum: '$metadata.errorCount' },
      },
    },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- build-stats-pipeline.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-b/src/processing-log/stats/build-stats-pipeline.ts back-end/service-b/src/processing-log/stats/build-stats-pipeline.spec.ts
```

---

## Task 3: `service-b` — `shapeStats` group-to-counters mapper

**Files:**
- Create: `back-end/service-b/src/processing-log/stats/shape-stats.ts`
- Create: `back-end/service-b/src/processing-log/stats/shape-stats.spec.ts`

**Interfaces:**
- Produces: `IStatsGroup { _id: string; count: number; eventsProcessed: number; validEvents: number;
  invalidEvents: number; errorCount: number }` (the shape `buildStatsPipeline`'s `$group` stage produces),
  `IMongoStats { archivesProcessed: number; eventsProcessed: number; successfulEvents: number;
  invalidEvents: number; errors: number }`, `shapeStats(groups: IStatsGroup[]): IMongoStats` — pure
  function per Global Constraints' `archivesProcessed`/`errors` composition rules.
- Consumed by: Task 6 (`get-stats.ts`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-b/src/processing-log/stats/shape-stats.spec.ts`:
```ts
import { shapeStats } from './shape-stats.js';

describe('shapeStats', () => {
  it('should return all zeros, when no groups are given', () => {
    expect(shapeStats([])).toEqual({
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 0,
    });
  });

  it("should map the completed group's counters, when a completed group exists", () => {
    const groups = [
      {
        _id: 'completed',
        count: 3,
        eventsProcessed: 300,
        validEvents: 290,
        invalidEvents: 10,
        errorCount: 0,
      },
    ];

    expect(shapeStats(groups)).toEqual({
      archivesProcessed: 3,
      eventsProcessed: 300,
      successfulEvents: 290,
      invalidEvents: 10,
      errors: 0,
    });
  });

  it('should count failed archives as errors, when only a failed group exists', () => {
    const groups = [
      { _id: 'failed', count: 2, eventsProcessed: 0, validEvents: 0, invalidEvents: 0, errorCount: 0 },
    ];

    expect(shapeStats(groups)).toEqual({
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 2,
    });
  });

  it('should sum failed count and completed errorCount into errors, when both groups exist', () => {
    const groups = [
      {
        _id: 'completed',
        count: 3,
        eventsProcessed: 300,
        validEvents: 290,
        invalidEvents: 10,
        errorCount: 4,
      },
      { _id: 'failed', count: 2, eventsProcessed: 0, validEvents: 0, invalidEvents: 0, errorCount: 0 },
    ];

    expect(shapeStats(groups).errors).toBe(6);
  });

  it('should ignore a started group, when present alongside completed and failed', () => {
    const groups = [
      { _id: 'started', count: 5, eventsProcessed: 0, validEvents: 0, invalidEvents: 0, errorCount: 0 },
      {
        _id: 'completed',
        count: 1,
        eventsProcessed: 100,
        validEvents: 100,
        invalidEvents: 0,
        errorCount: 0,
      },
    ];

    expect(shapeStats(groups).archivesProcessed).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- shape-stats.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `shape-stats.ts`**

`back-end/service-b/src/processing-log/stats/shape-stats.ts`:
```ts
export interface IStatsGroup {
  _id: string;
  count: number;
  eventsProcessed: number;
  validEvents: number;
  invalidEvents: number;
  errorCount: number;
}

export interface IMongoStats {
  archivesProcessed: number;
  eventsProcessed: number;
  successfulEvents: number;
  invalidEvents: number;
  errors: number;
}

const COMPLETED_STATUS = 'completed';
const FAILED_STATUS = 'failed';

export function shapeStats(groups: IStatsGroup[]): IMongoStats {
  const completed = groups.find((group) => group._id === COMPLETED_STATUS);
  const failed = groups.find((group) => group._id === FAILED_STATUS);

  return {
    archivesProcessed: completed?.count ?? 0,
    eventsProcessed: completed?.eventsProcessed ?? 0,
    successfulEvents: completed?.validEvents ?? 0,
    invalidEvents: completed?.invalidEvents ?? 0,
    errors: (failed?.count ?? 0) + (completed?.errorCount ?? 0),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- shape-stats.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-b/src/processing-log/stats/shape-stats.ts back-end/service-b/src/processing-log/stats/shape-stats.spec.ts
```

---

## Task 4: `service-b` — `deriveImportDurationStats` (single-import duration/time-series)

**Files:**
- Create: `back-end/service-b/src/processing-log/stats/derive-import-duration-stats.ts`
- Create: `back-end/service-b/src/processing-log/stats/derive-import-duration-stats.spec.ts`

**Interfaces:**
- Consumes: `type IProcessingLogDocument` (Phase 6).
- Produces: `IImportTimeSeriesPoint { timestamp: string; value: number }`, `IImportDurationStats {
  processingDurationMs?: number; timeSeries: IImportTimeSeriesPoint[] }`,
  `deriveImportDurationStats(documents: IProcessingLogDocument[]): IImportDurationStats` — pure function.
  Finds the `started` and `completed` documents among the (at most 3) documents for one `importId`; when
  both exist, `processingDurationMs` is their timestamp difference and `timeSeries` is a single point at
  the completed timestamp with the completed run's `eventsProcessed` count; otherwise
  `{ timeSeries: [] }` with no `processingDurationMs`.
- Consumed by: Task 6 (`get-stats.ts`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-b/src/processing-log/stats/derive-import-duration-stats.spec.ts`:
```ts
import { type IProcessingLogDocument } from '../processing-log.types.js';

import { deriveImportDurationStats } from './derive-import-duration-stats.js';

describe('deriveImportDurationStats', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const correlationId = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const archive = '2026-08-11-0.json.gz';

  function buildDocument(overrides: Partial<IProcessingLogDocument>): IProcessingLogDocument {
    return {
      importId,
      eventType: 'github.import.started',
      service: 'service-a',
      status: 'started',
      timestamp: new Date('2026-08-11T00:00:00.000Z'),
      correlationId,
      archive,
      metadata: {},
      ...overrides,
    };
  }

  it('should return empty timeSeries and no processingDurationMs, when no documents are given', () => {
    expect(deriveImportDurationStats([])).toEqual({ timeSeries: [] });
  });

  it('should return empty timeSeries and no processingDurationMs, when only a started document exists', () => {
    const documents = [buildDocument({ status: 'started' })];

    expect(deriveImportDurationStats(documents)).toEqual({ timeSeries: [] });
  });

  it('should compute the duration and a single time-series point, when both started and completed documents exist', () => {
    const documents = [
      buildDocument({ status: 'started', timestamp: new Date('2026-08-11T00:00:00.000Z') }),
      buildDocument({
        status: 'completed',
        timestamp: new Date('2026-08-11T00:05:00.000Z'),
        metadata: { eventsProcessed: 500, validEvents: 480, invalidEvents: 20, duplicateEvents: 0, errorCount: 0 },
      }),
    ];

    expect(deriveImportDurationStats(documents)).toEqual({
      processingDurationMs: 300_000,
      timeSeries: [{ timestamp: '2026-08-11T00:05:00.000Z', value: 500 }],
    });
  });

  it('should ignore a failed document, when deriving duration for a completed import', () => {
    const documents = [
      buildDocument({ status: 'started', timestamp: new Date('2026-08-11T00:00:00.000Z') }),
      buildDocument({
        status: 'completed',
        timestamp: new Date('2026-08-11T00:05:00.000Z'),
        metadata: { eventsProcessed: 500, validEvents: 480, invalidEvents: 20, duplicateEvents: 0, errorCount: 0 },
      }),
      buildDocument({
        status: 'failed',
        timestamp: new Date('2026-08-11T00:06:00.000Z'),
        errorInfo: { reason: 'redelivered duplicate' },
      }),
    ];

    expect(deriveImportDurationStats(documents).processingDurationMs).toBe(300_000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- derive-import-duration-stats.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `derive-import-duration-stats.ts`**

`back-end/service-b/src/processing-log/stats/derive-import-duration-stats.ts`:
```ts
import { type IProcessingLogDocument } from '../processing-log.types.js';

export interface IImportTimeSeriesPoint {
  timestamp: string;
  value: number;
}

export interface IImportDurationStats {
  processingDurationMs?: number;
  timeSeries: IImportTimeSeriesPoint[];
}

export function deriveImportDurationStats(
  documents: IProcessingLogDocument[],
): IImportDurationStats {
  const started = documents.find((document) => document.status === 'started');
  const completed = documents.find((document) => document.status === 'completed');

  if (started === undefined || completed === undefined) {
    return { timeSeries: [] };
  }

  return {
    processingDurationMs: completed.timestamp.getTime() - started.timestamp.getTime(),
    timeSeries: [
      {
        timestamp: completed.timestamp.toISOString(),
        value: completed.metadata.eventsProcessed,
      },
    ],
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- derive-import-duration-stats.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-b/src/processing-log/stats/derive-import-duration-stats.ts back-end/service-b/src/processing-log/stats/derive-import-duration-stats.spec.ts
```

---

## Task 5: `service-b` — `StatsMetricsReader` (RedisTimeSeries reads)

**Files:**
- Create: `back-end/service-b/src/processing-log/stats/stats-metrics-reader.service.ts`
- Create: `back-end/service-b/src/processing-log/stats/stats-metrics-reader.service.spec.ts`

**Interfaces:**
- Consumes: `REDIS_CLIENT` (`../../infra/infra-clients.tokens.js`, `@Global()`-scoped — Phase 0), `type
  RedisConfiguration`/`redisConfig` (Task 1), `type IImportTimeSeriesPoint` (Task 4).
- Produces: `StatsMetricsReader.readAverageProcessingDuration(): Promise<number | undefined>` (`TS.RANGE`
  over the full retention window with `AGGREGATION avg <retentionMs>`, collapsing to one averaged sample;
  `undefined` when the series is empty or Redis is unreachable),
  `StatsMetricsReader.readEventsTimeSeries(): Promise<IImportTimeSeriesPoint[]>` (`TS.RANGE` with
  `AGGREGATION avg <bucketMs>`, `bucketMs` sized so at most `MAX_TIME_SERIES_POINTS` (50) samples come
  back; `[]` when Redis is unreachable). Both swallow Redis errors (Global Constraints).
- Consumed by: Task 6 (`get-stats.ts`), Task 8 (`ProcessingLogModule`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-b/src/processing-log/stats/stats-metrics-reader.service.spec.ts`:
```ts
import { type LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Redis } from 'ioredis';

import { type RedisConfiguration } from '../../config/redis.config.js';

import { StatsMetricsReader } from './stats-metrics-reader.service.js';

describe('StatsMetricsReader', () => {
  const redisConfiguration: RedisConfiguration = {
    url: 'redis://localhost:6379',
    metricsRetentionMs: 604_800_000,
  };

  function buildReader(
    call: ReturnType<typeof vi.fn>,
    warnMock: ReturnType<typeof vi.fn> = vi.fn(),
  ): StatsMetricsReader {
    const client = { call } as unknown as Redis;
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ warn: warnMock }),
    } as unknown as LoggerService;

    return new StatsMetricsReader(client, redisConfiguration, loggerService);
  }

  describe('readAverageProcessingDuration', () => {
    it('should return the last averaged sample as a number, when Redis returns TS.RANGE data', async () => {
      const call = vi.fn().mockResolvedValue([
        [1_691_712_000_000, '100'],
        [1_691_712_120_000, '150'],
      ]);
      const reader = buildReader(call);

      await expect(reader.readAverageProcessingDuration()).resolves.toBe(150);
    });

    it('should return undefined, when Redis returns an empty series', async () => {
      const call = vi.fn().mockResolvedValue([]);
      const reader = buildReader(call);

      await expect(reader.readAverageProcessingDuration()).resolves.toBeUndefined();
    });

    it('should call TS.RANGE with AGGREGATION avg bucketed by the configured retention, when called', async () => {
      const call = vi.fn().mockResolvedValue([]);
      const reader = buildReader(call);

      await reader.readAverageProcessingDuration();

      expect(call).toHaveBeenCalledWith(
        'TS.RANGE',
        'service_a.archive.processing.duration',
        '-',
        '+',
        'AGGREGATION',
        'avg',
        604_800_000,
      );
    });

    it('should return undefined and log a warning, when Redis rejects', async () => {
      const call = vi.fn().mockRejectedValue(new Error('connection lost'));
      const warnMock = vi.fn();
      const reader = buildReader(call, warnMock);

      await expect(reader.readAverageProcessingDuration()).resolves.toBeUndefined();
      expect(warnMock).toHaveBeenCalledWith(
        { error: 'connection lost' },
        'Failed to read average processing duration metric',
      );
    });
  });

  describe('readEventsTimeSeries', () => {
    it('should map each TS.RANGE sample to an ISO timestamp and numeric value, when Redis returns data', async () => {
      const call = vi.fn().mockResolvedValue([
        [1_691_712_000_000, '10'],
        [1_691_712_120_000, '12'],
      ]);
      const reader = buildReader(call);

      await expect(reader.readEventsTimeSeries()).resolves.toEqual([
        { timestamp: new Date(1_691_712_000_000).toISOString(), value: 10 },
        { timestamp: new Date(1_691_712_120_000).toISOString(), value: 12 },
      ]);
    });

    it('should call TS.RANGE with a bucket size capping the series at 50 points, when called', async () => {
      const call = vi.fn().mockResolvedValue([]);
      const reader = buildReader(call);

      await reader.readEventsTimeSeries();

      expect(call).toHaveBeenCalledWith(
        'TS.RANGE',
        'service_a.archive.events.processed',
        '-',
        '+',
        'AGGREGATION',
        'avg',
        Math.ceil(604_800_000 / 50),
      );
    });

    it('should return an empty array and log a warning, when Redis rejects', async () => {
      const call = vi.fn().mockRejectedValue(new Error('connection lost'));
      const warnMock = vi.fn();
      const reader = buildReader(call, warnMock);

      await expect(reader.readEventsTimeSeries()).resolves.toEqual([]);
      expect(warnMock).toHaveBeenCalledWith(
        { error: 'connection lost' },
        'Failed to read events-processed time series metric',
      );
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- stats-metrics-reader.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `stats-metrics-reader.service.ts`**

`back-end/service-b/src/processing-log/stats/stats-metrics-reader.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Redis } from 'ioredis';

import redisConfig, { type RedisConfiguration } from '../../config/redis.config.js';
import { REDIS_CLIENT } from '../../infra/infra-clients.tokens.js';

import { type IImportTimeSeriesPoint } from './derive-import-duration-stats.js';

const METRIC_PROCESSING_DURATION = 'service_a.archive.processing.duration';
const METRIC_EVENTS_PROCESSED = 'service_a.archive.events.processed';
const MAX_TIME_SERIES_POINTS = 50;
const FAILED_READ_DURATION_LOG = 'Failed to read average processing duration metric';
const FAILED_READ_TIME_SERIES_LOG = 'Failed to read events-processed time series metric';

type TsRangeReply = Array<[number, string]>;

@Injectable()
export class StatsMetricsReader {
  public constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    @Inject(redisConfig.KEY) private readonly redisConfiguration: RedisConfiguration,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger('StatsMetricsReader');
  }

  public async readAverageProcessingDuration(): Promise<number | undefined> {
    try {
      const reply = (await this.client.call(
        'TS.RANGE',
        METRIC_PROCESSING_DURATION,
        '-',
        '+',
        'AGGREGATION',
        'avg',
        this.redisConfiguration.metricsRetentionMs,
      )) as TsRangeReply;

      const lastSample = reply.at(-1);

      return lastSample === undefined ? undefined : Number(lastSample[1]);
    } catch (error) {
      this.logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        FAILED_READ_DURATION_LOG,
      );

      return undefined;
    }
  }

  public async readEventsTimeSeries(): Promise<IImportTimeSeriesPoint[]> {
    const bucketMs = Math.ceil(this.redisConfiguration.metricsRetentionMs / MAX_TIME_SERIES_POINTS);

    try {
      const reply = (await this.client.call(
        'TS.RANGE',
        METRIC_EVENTS_PROCESSED,
        '-',
        '+',
        'AGGREGATION',
        'avg',
        bucketMs,
      )) as TsRangeReply;

      return reply.map(([timestamp, value]) => ({
        timestamp: new Date(timestamp).toISOString(),
        value: Number(value),
      }));
    } catch (error) {
      this.logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        FAILED_READ_TIME_SERIES_LOG,
      );

      return [];
    }
  }

  private readonly logger: AppLogger;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- stats-metrics-reader.service.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-b/src/processing-log/stats/stats-metrics-reader.service.ts back-end/service-b/src/processing-log/stats/stats-metrics-reader.service.spec.ts
```

---

## Task 6: `service-b` — `getStats` orchestration function

**Files:**
- Create: `back-end/service-b/src/processing-log/stats/get-stats.ts`
- Create: `back-end/service-b/src/processing-log/stats/get-stats.spec.ts`

**Interfaces:**
- Consumes: `buildStatsPipeline` (Task 2), `shapeStats`/`type IStatsGroup` (Task 3),
  `deriveImportDurationStats` (Task 4), `type StatsMetricsReader` (Task 5), `type IProcessingLogDocument`
  (Phase 6), `type Collection` (`mongodb`).
- Produces: `IStatsResult { archivesProcessed: number; eventsProcessed: number; successfulEvents: number;
  invalidEvents: number; errors: number; processingDurationMs?: number; timeSeries:
  IImportTimeSeriesPoint[] }`, `getStats(collection: Collection<IProcessingLogDocument>, metricsReader:
  StatsMetricsReader, importId?: string): Promise<IStatsResult>` — always runs the Mongo aggregation; when
  `importId` is given, additionally `find()`s that import's own documents and derives duration/time-series
  from them (no Redis call); otherwise reads both from `StatsMetricsReader` (Global Constraints Finding 1).
- Consumed by: Task 7 (`StatsService`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-b/src/processing-log/stats/get-stats.spec.ts`:
```ts
import { type Collection } from 'mongodb';

import { type IProcessingLogDocument } from '../processing-log.types.js';

import { buildStatsPipeline } from './build-stats-pipeline.js';
import { getStats } from './get-stats.js';
import { type StatsMetricsReader } from './stats-metrics-reader.service.js';

describe('getStats', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const correlationId = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  function buildCollection(
    groups: unknown[],
    documents: IProcessingLogDocument[] = [],
  ): {
    collection: Collection<IProcessingLogDocument>;
    aggregate: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
  } {
    const aggregate = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(groups) });
    const find = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(documents) });

    return { collection: { aggregate, find } as unknown as Collection<IProcessingLogDocument>, aggregate, find };
  }

  function buildMetricsReader(
    processingDurationMs: number | undefined,
    timeSeries: Array<{ timestamp: string; value: number }>,
  ): { reader: StatsMetricsReader; readAverageProcessingDuration: ReturnType<typeof vi.fn>; readEventsTimeSeries: ReturnType<typeof vi.fn> } {
    const readAverageProcessingDuration = vi.fn().mockResolvedValue(processingDurationMs);
    const readEventsTimeSeries = vi.fn().mockResolvedValue(timeSeries);

    return {
      reader: { readAverageProcessingDuration, readEventsTimeSeries } as unknown as StatsMetricsReader,
      readAverageProcessingDuration,
      readEventsTimeSeries,
    };
  }

  it('should return zeroed stats and empty timeSeries, when nothing matches and no importId is given', async () => {
    const { collection } = buildCollection([]);
    const { reader } = buildMetricsReader(undefined, []);

    const result = await getStats(collection, reader);

    expect(result).toEqual({
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 0,
      timeSeries: [],
    });
  });

  it('should combine mongo aggregation stats with Redis metrics, when no importId is given', async () => {
    const groups = [
      { _id: 'completed', count: 2, eventsProcessed: 200, validEvents: 190, invalidEvents: 10, errorCount: 0 },
    ];
    const { collection } = buildCollection(groups);
    const timeSeries = [{ timestamp: '2026-08-11T00:00:00.000Z', value: 100 }];
    const { reader } = buildMetricsReader(15_000, timeSeries);

    const result = await getStats(collection, reader);

    expect(result).toEqual({
      archivesProcessed: 2,
      eventsProcessed: 200,
      successfulEvents: 190,
      invalidEvents: 10,
      errors: 0,
      processingDurationMs: 15_000,
      timeSeries,
    });
  });

  it('should query find() and derive duration from timestamps, when importId is given', async () => {
    const groups = [
      { _id: 'completed', count: 1, eventsProcessed: 500, validEvents: 480, invalidEvents: 20, errorCount: 0 },
    ];
    const documents: IProcessingLogDocument[] = [
      {
        importId,
        eventType: 'github.import.started',
        service: 'service-a',
        status: 'started',
        timestamp: new Date('2026-08-11T00:00:00.000Z'),
        correlationId,
        archive: '2026-08-11-0.json.gz',
        metadata: {},
      },
      {
        importId,
        eventType: 'github.import.completed',
        service: 'service-a',
        status: 'completed',
        timestamp: new Date('2026-08-11T00:05:00.000Z'),
        correlationId,
        archive: '2026-08-11-0.json.gz',
        metadata: { eventsProcessed: 500, validEvents: 480, invalidEvents: 20, duplicateEvents: 0, errorCount: 0 },
      },
    ];
    const { collection, aggregate, find } = buildCollection(groups, documents);
    const { reader, readAverageProcessingDuration, readEventsTimeSeries } = buildMetricsReader(undefined, []);

    const result = await getStats(collection, reader, importId);

    expect(aggregate).toHaveBeenCalledWith(buildStatsPipeline(importId));
    expect(find).toHaveBeenCalledWith({ importId });
    expect(readAverageProcessingDuration).not.toHaveBeenCalled();
    expect(readEventsTimeSeries).not.toHaveBeenCalled();
    expect(result).toEqual({
      archivesProcessed: 1,
      eventsProcessed: 500,
      successfulEvents: 480,
      invalidEvents: 20,
      errors: 0,
      processingDurationMs: 300_000,
      timeSeries: [{ timestamp: '2026-08-11T00:05:00.000Z', value: 500 }],
    });
  });

  it('should omit processingDurationMs and return empty timeSeries, when importId is given but only a started log exists', async () => {
    const documents: IProcessingLogDocument[] = [
      {
        importId,
        eventType: 'github.import.started',
        service: 'service-a',
        status: 'started',
        timestamp: new Date('2026-08-11T00:00:00.000Z'),
        correlationId,
        archive: '2026-08-11-0.json.gz',
        metadata: {},
      },
    ];
    const { collection } = buildCollection([], documents);
    const { reader } = buildMetricsReader(undefined, []);

    const result = await getStats(collection, reader, importId);

    expect(result.processingDurationMs).toBeUndefined();
    expect(result.timeSeries).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- get-stats.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `get-stats.ts`**

`back-end/service-b/src/processing-log/stats/get-stats.ts`:
```ts
import { type Collection } from 'mongodb';

import { type IProcessingLogDocument } from '../processing-log.types.js';

import { buildStatsPipeline } from './build-stats-pipeline.js';
import {
  deriveImportDurationStats,
  type IImportTimeSeriesPoint,
} from './derive-import-duration-stats.js';
import { shapeStats, type IStatsGroup } from './shape-stats.js';
import { type StatsMetricsReader } from './stats-metrics-reader.service.js';

export interface IStatsResult {
  archivesProcessed: number;
  eventsProcessed: number;
  successfulEvents: number;
  invalidEvents: number;
  errors: number;
  processingDurationMs?: number;
  timeSeries: IImportTimeSeriesPoint[];
}

export async function getStats(
  collection: Collection<IProcessingLogDocument>,
  metricsReader: StatsMetricsReader,
  importId?: string,
): Promise<IStatsResult> {
  const groups = await collection.aggregate<IStatsGroup>(buildStatsPipeline(importId)).toArray();
  const mongoStats = shapeStats(groups);

  if (importId === undefined) {
    const [processingDurationMs, timeSeries] = await Promise.all([
      metricsReader.readAverageProcessingDuration(),
      metricsReader.readEventsTimeSeries(),
    ]);

    return {
      ...mongoStats,
      ...(processingDurationMs === undefined ? {} : { processingDurationMs }),
      timeSeries,
    };
  }

  const documents = await collection.find({ importId }).toArray();
  const importDurationStats = deriveImportDurationStats(documents);

  return {
    ...mongoStats,
    ...(importDurationStats.processingDurationMs === undefined
      ? {}
      : { processingDurationMs: importDurationStats.processingDurationMs }),
    timeSeries: importDurationStats.timeSeries,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- get-stats.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-b/src/processing-log/stats/get-stats.ts back-end/service-b/src/processing-log/stats/get-stats.spec.ts
```

---

## Task 7: `service-b` — inbound message schema, `StatsService`, `StatsController`

**Files:**
- Create: `back-end/service-b/src/processing-log/stats/get-stats-message.schema.ts`
- Create: `back-end/service-b/src/processing-log/stats/get-stats-message.schema.spec.ts`
- Create: `back-end/service-b/src/processing-log/stats/stats.service.ts`
- Create: `back-end/service-b/src/processing-log/stats/stats.service.spec.ts`
- Create: `back-end/service-b/src/processing-log/stats/stats.controller.ts`
- Create: `back-end/service-b/src/processing-log/stats/stats.controller.spec.ts`

**Interfaces:**
- Produces: `getStatsMessageSchema` (Zod), `type GetStatsMessage = { importId?: string }`;
  `StatsService.getStats(importId?: string): Promise<IStatsResult>` (thin injectable wrapper around
  `getStats`, mirrors `LogsSearchService`); `StatsController` — `@MessagePattern('stats.get')`,
  request/reply, acks in a `finally` (Global Constraints, same as `LogsSearchController`).
- Consumed by: Task 8 (`ProcessingLogModule`), gateway's `StatsController` (Task 12) via
  `ClientProxy.send('stats.get', ...)`.

- [ ] **Step 1: Write the failing tests for the message schema**

`back-end/service-b/src/processing-log/stats/get-stats-message.schema.spec.ts`:
```ts
import { getStatsMessageSchema } from './get-stats-message.schema.js';

describe('getStatsMessageSchema', () => {
  it('should parse successfully with importId undefined, when no importId is provided', () => {
    expect(getStatsMessageSchema.parse({})).toEqual({ importId: undefined });
  });

  it('should parse successfully, when importId is a valid uuid', () => {
    const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

    expect(getStatsMessageSchema.parse({ importId })).toEqual({ importId });
  });

  it('should throw, when importId is not a uuid', () => {
    expect(() => getStatsMessageSchema.parse({ importId: 'not-a-uuid' })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- get-stats-message.schema.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `get-stats-message.schema.ts`**

`back-end/service-b/src/processing-log/stats/get-stats-message.schema.ts`:
```ts
import { z } from 'zod';

export const getStatsMessageSchema = z.object({
  importId: z.uuid().optional(),
});

export type GetStatsMessage = z.infer<typeof getStatsMessageSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- get-stats-message.schema.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test for `StatsService`**

`back-end/service-b/src/processing-log/stats/stats.service.spec.ts`:
```ts
import { type Collection } from 'mongodb';

import { type IProcessingLogDocument } from '../processing-log.types.js';

import { StatsService } from './stats.service.js';
import { type StatsMetricsReader } from './stats-metrics-reader.service.js';

describe('StatsService', () => {
  it('should delegate to getStats with the injected collection and metrics reader, when getStats is called', async () => {
    const aggregate = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    const find = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    const collection = { aggregate, find } as unknown as Collection<IProcessingLogDocument>;
    const metricsReader = {
      readAverageProcessingDuration: vi.fn().mockResolvedValue(undefined),
      readEventsTimeSeries: vi.fn().mockResolvedValue([]),
    } as unknown as StatsMetricsReader;
    const service = new StatsService(collection, metricsReader);

    const result = await service.getStats();

    expect(result).toEqual({
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 0,
      timeSeries: [],
    });
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- stats.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `stats.service.ts`**

`back-end/service-b/src/processing-log/stats/stats.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { type Collection } from 'mongodb';

import { PROCESSING_LOG_COLLECTION } from '../processing-log-collection.provider.js';
import { type IProcessingLogDocument } from '../processing-log.types.js';

import { getStats, type IStatsResult } from './get-stats.js';
import { StatsMetricsReader } from './stats-metrics-reader.service.js';

@Injectable()
export class StatsService {
  public constructor(
    @Inject(PROCESSING_LOG_COLLECTION)
    private readonly collection: Collection<IProcessingLogDocument>,
    private readonly metricsReader: StatsMetricsReader,
  ) {}

  public getStats(importId?: string): Promise<IStatsResult> {
    return getStats(this.collection, this.metricsReader, importId);
  }
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- stats.service.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 9: Write the failing tests for `StatsController`**

`back-end/service-b/src/processing-log/stats/stats.controller.spec.ts`:
```ts
import { type RmqContext } from '@nestjs/microservices';

import { StatsController } from './stats.controller.js';
import { type StatsService } from './stats.service.js';

describe('StatsController', () => {
  function buildContext(): {
    context: RmqContext;
    message: Record<string, unknown>;
    ack: ReturnType<typeof vi.fn>;
  } {
    const message = { content: Buffer.from('{}'), properties: { headers: {} } };
    const ack = vi.fn();
    const context = {
      getChannelRef: vi.fn().mockReturnValue({ ack }),
      getMessage: vi.fn().mockReturnValue(message),
    } as unknown as RmqContext;

    return { context, message, ack };
  }

  it('should validate the payload, delegate to StatsService, and ack, when a valid message is received', async () => {
    const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const statsResult = { archivesProcessed: 1, eventsProcessed: 1, successfulEvents: 1, invalidEvents: 0, errors: 0, timeSeries: [] };
    const getStats = vi.fn().mockResolvedValue(statsResult);
    const statsService = { getStats } as unknown as StatsService;
    const controller = new StatsController(statsService);
    const { context, message, ack } = buildContext();

    const result = await controller.handleGetStats({ importId }, context);

    expect(result).toBe(statsResult);
    expect(getStats).toHaveBeenCalledWith(importId);
    expect(ack).toHaveBeenCalledWith(message);
  });

  it('should reject but still ack, when the payload fails schema validation', async () => {
    const getStats = vi.fn();
    const statsService = { getStats } as unknown as StatsService;
    const controller = new StatsController(statsService);
    const { context, message, ack } = buildContext();

    await expect(controller.handleGetStats({ importId: 'not-a-uuid' }, context)).rejects.toThrow();
    expect(getStats).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith(message);
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- stats.controller.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 11: Implement `stats.controller.ts`**

`back-end/service-b/src/processing-log/stats/stats.controller.ts`:
```ts
import { Controller } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, type RmqContext } from '@nestjs/microservices';

import { getStatsMessageSchema } from './get-stats-message.schema.js';
import { type IStatsResult } from './get-stats.js';
import { StatsService } from './stats.service.js';

@Controller()
export class StatsController {
  public constructor(private readonly statsService: StatsService) {}

  @MessagePattern('stats.get')
  public async handleGetStats(
    @Payload() payload: unknown,
    @Ctx() context: RmqContext,
  ): Promise<IStatsResult> {
    try {
      const message = getStatsMessageSchema.parse(payload);

      return await this.statsService.getStats(message.importId);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- RmqContext channel is loosely typed; matches HealthController's manual-ack precedent under noAck: false
      context.getChannelRef().ack(context.getMessage());
    }
  }
}
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- stats.controller.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 13: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 14: Stage the files**

```bash
git add back-end/service-b/src/processing-log/stats/get-stats-message.schema.ts back-end/service-b/src/processing-log/stats/get-stats-message.schema.spec.ts back-end/service-b/src/processing-log/stats/stats.service.ts back-end/service-b/src/processing-log/stats/stats.service.spec.ts back-end/service-b/src/processing-log/stats/stats.controller.ts back-end/service-b/src/processing-log/stats/stats.controller.spec.ts
```

---

## Task 8: `service-b` — wire `StatsController`/`StatsService`/`StatsMetricsReader` into `ProcessingLogModule`

**Files:**
- Modify: `back-end/service-b/src/processing-log/processing-log.module.ts`

**Interfaces:** none new — pure wiring.

- [ ] **Step 1: Update `processing-log.module.ts`**

Replace the full contents of `back-end/service-b/src/processing-log/processing-log.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { LoggerModule } from '@task1/shared/logger/rmq/logger.module';

import { EnsureProcessingLogIndexesInitializer } from './ensure-processing-log-indexes-initializer.service.js';
import { ImportEventsController } from './import-events.controller.js';
import { processingLogCollectionProvider } from './processing-log-collection.provider.js';
import { ProcessingLogTracker } from './processing-log-tracker.service.js';
import { LogsSearchController } from './search/logs-search.controller.js';
import { LogsSearchService } from './search/logs-search.service.js';
import { StatsController } from './stats/stats.controller.js';
import { StatsMetricsReader } from './stats/stats-metrics-reader.service.js';
import { StatsService } from './stats/stats.service.js';

@Module({
  imports: [LoggerModule],
  controllers: [ImportEventsController, LogsSearchController, StatsController],
  providers: [
    processingLogCollectionProvider,
    EnsureProcessingLogIndexesInitializer,
    ProcessingLogTracker,
    LogsSearchService,
    StatsMetricsReader,
    StatsService,
  ],
})
export class ProcessingLogModule {}
```

- [ ] **Step 2: Run the full `service-b` test suite**

Run: `pnpm --filter service-b test`
Expected: PASS — every existing suite plus this phase's new specs.

- [ ] **Step 3: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 4: Stage the file**

```bash
git add back-end/service-b/src/processing-log/processing-log.module.ts
```

---

## Task 9: `api-gateway` — `GetStatsQueryDto`

**Files:**
- Create: `back-end/api-gateway/src/stats/dto/get-stats-query.dto.ts`
- Create: `back-end/api-gateway/src/stats/dto/get-stats-query.dto.spec.ts`

**Interfaces:**
- Produces: `GetStatsQueryDto { importId?: string }` — validated by the gateway's existing global
  `ValidationPipe` (`whitelist: true, transform: true, forbidNonWhitelisted: true`).
- Consumed by: Task 12 (`StatsController`).

- [ ] **Step 1: Write the failing tests**

`back-end/api-gateway/src/stats/dto/get-stats-query.dto.spec.ts`:
```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { GetStatsQueryDto } from './get-stats-query.dto.js';

describe('GetStatsQueryDto', () => {
  it('should produce no validation errors, when importId is omitted', async () => {
    const dto = plainToInstance(GetStatsQueryDto, {});

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.importId).toBeUndefined();
  });

  it('should produce no validation errors, when importId is a valid uuid', async () => {
    const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const dto = plainToInstance(GetStatsQueryDto, { importId });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.importId).toBe(importId);
  });

  it('should produce a validation error, when importId is not a uuid', async () => {
    const dto = plainToInstance(GetStatsQueryDto, { importId: 'not-a-uuid' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter api-gateway test -- get-stats-query.dto.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `get-stats-query.dto.ts`**

`back-end/api-gateway/src/stats/dto/get-stats-query.dto.ts`:
```ts
import { IsOptional, IsUUID } from 'class-validator';

export class GetStatsQueryDto {
  @IsOptional()
  @IsUUID()
  public readonly importId?: string;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter api-gateway test -- get-stats-query.dto.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter api-gateway lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/api-gateway/src/stats/dto/get-stats-query.dto.ts back-end/api-gateway/src/stats/dto/get-stats-query.dto.spec.ts
```

---

## Task 10: `api-gateway` — response DTOs

**Files:**
- Create: `back-end/api-gateway/src/stats/dto/stats-response.dto.ts`

**Interfaces:**
- Produces: `IStatsTimeSeriesPointView { timestamp: string; value: number }`, `IStatsView { ... }` (the
  gateway's own view of the `stats.get` RMQ reply — matches `service-b`'s `IStatsResult` field-for-field,
  since JSON-serialization over RMQ doesn't change any field's shape here, unlike Phase 7's `timestamp:
  Date` case), `StatsTimeSeriesPointDto`, `StatsResponseDto` (constructor: `(view: IStatsView)`).
- Consumed by: Task 12 (`StatsController`).

This task has no dedicated unit test — both are plain data-mapping classes with only a single
`processingDurationMs` optional-field branch, matching `LogResponseDto`'s precedent (Phase 7); their shape
is exercised by Task 13's integration test.

- [ ] **Step 1: Implement `stats-response.dto.ts`**

`back-end/api-gateway/src/stats/dto/stats-response.dto.ts`:
```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export interface IStatsTimeSeriesPointView {
  timestamp: string;
  value: number;
}

export interface IStatsView {
  archivesProcessed: number;
  eventsProcessed: number;
  successfulEvents: number;
  invalidEvents: number;
  errors: number;
  processingDurationMs?: number;
  timeSeries: IStatsTimeSeriesPointView[];
}

export class StatsTimeSeriesPointDto {
  @ApiProperty({ example: '2026-08-11T00:00:00.000Z' })
  public readonly timestamp: string;

  @ApiProperty({ example: 42 })
  public readonly value: number;

  public constructor(point: IStatsTimeSeriesPointView) {
    this.timestamp = point.timestamp;
    this.value = point.value;
  }
}

export class StatsResponseDto {
  @ApiProperty({ example: 12 })
  public readonly archivesProcessed: number;

  @ApiProperty({ example: 48_000 })
  public readonly eventsProcessed: number;

  @ApiProperty({ example: 47_500 })
  public readonly successfulEvents: number;

  @ApiProperty({ example: 500 })
  public readonly invalidEvents: number;

  @ApiProperty({ example: 3 })
  public readonly errors: number;

  @ApiPropertyOptional({ example: 15_230 })
  public readonly processingDurationMs?: number;

  @ApiProperty({ type: [StatsTimeSeriesPointDto] })
  public readonly timeSeries: StatsTimeSeriesPointDto[];

  public constructor(view: IStatsView) {
    this.archivesProcessed = view.archivesProcessed;
    this.eventsProcessed = view.eventsProcessed;
    this.successfulEvents = view.successfulEvents;
    this.invalidEvents = view.invalidEvents;
    this.errors = view.errors;
    this.timeSeries = view.timeSeries.map((point) => new StatsTimeSeriesPointDto(point));

    if (view.processingDurationMs !== undefined) {
      this.processingDurationMs = view.processingDurationMs;
    }
  }
}
```

- [ ] **Step 2: Lint**

Run: `pnpm --filter api-gateway lint`
Expected: PASS.

- [ ] **Step 3: Stage the file**

```bash
git add back-end/api-gateway/src/stats/dto/stats-response.dto.ts
```

---

## Task 11: `api-gateway` — `SERVICE_B_RMQ_CLIENT` token and `StatsModule`

**Files:**
- Create: `back-end/api-gateway/src/stats/rabbitmq-client.token.ts`
- Create: `back-end/api-gateway/src/stats/stats.module.ts`

**Interfaces:**
- Consumes: `rabbitmqConfig` (existing).
- Produces: `SERVICE_B_RMQ_CLIENT` (string DI token, module-scoped to `StatsModule`), `StatsModule`
  (registers the RMQ client pointed at `rabbitmqConfig().serviceBQueue`, declares `StatsController`).
- Consumed by: Task 12 (`StatsController`), Task 13 (integration test), Task 14 (`app.module.ts`).

This task has no dedicated unit test — `ClientsModule.registerAsync` is framework wiring, exercised
end-to-end by Task 13's integration test (matching `LogsModule`'s precedent).

- [ ] **Step 1: Create the token file**

`back-end/api-gateway/src/stats/rabbitmq-client.token.ts`:
```ts
export const SERVICE_B_RMQ_CLIENT = 'SERVICE_B_RMQ_CLIENT';
```

- [ ] **Step 2: Implement `stats.module.ts`**

`back-end/api-gateway/src/stats/stats.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';

import rabbitmqConfig from '../config/rabbitmq.config.js';

import { SERVICE_B_RMQ_CLIENT } from './rabbitmq-client.token.js';
import { StatsController } from './stats.controller.js';

@Module({
  imports: [
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
  controllers: [StatsController],
})
export class StatsModule {}
```

- [ ] **Step 3: Lint** (will fail until Task 12 creates `stats.controller.ts` — proceed to Task 12 first if
  executing strictly in order; both are commonly implemented and linted together)

Run: `pnpm --filter api-gateway lint`
Expected: PASS after Task 12.

- [ ] **Step 4: Stage the files**

```bash
git add back-end/api-gateway/src/stats/rabbitmq-client.token.ts back-end/api-gateway/src/stats/stats.module.ts
```

---

## Task 12: `api-gateway` — `StatsController`

**Files:**
- Create: `back-end/api-gateway/src/stats/stats.controller.ts`

**Interfaces:**
- Consumes: `SERVICE_B_RMQ_CLIENT` (Task 11), `GetStatsQueryDto` (Task 9), `type IStatsView`/
  `StatsResponseDto` (Task 10), `rabbitmqConfig` (existing), `buildOutboundHeaders`/`RequestContextService`
  (`@task1/shared/request-context`, existing — same as `LogsController`'s precedent).
- Produces: `StatsController` — `GET /stats` (full runtime path `/api/v1/stats` once `main.ts`'s global
  prefix/versioning apply).
- Consumed by: Task 11 (`StatsModule.controllers`), Task 13 (integration test).

This is a business-RPC (`send()`, request/reply) call site with an HTTP listener and a live RMQ client
dependency — per the testing skill it gets an `.int.spec.ts` (Task 13), not a `.spec.ts`.

- [ ] **Step 1: Implement `stats.controller.ts`**

`back-end/api-gateway/src/stats/stats.controller.ts`:
```ts
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { buildOutboundHeaders } from '@task1/shared/request-context/propagation.util';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { firstValueFrom, timeout } from 'rxjs';

import rabbitmqConfig from '../config/rabbitmq.config.js';

import { GetStatsQueryDto } from './dto/get-stats-query.dto.js';
import { type IStatsView, StatsResponseDto } from './dto/stats-response.dto.js';
import { SERVICE_B_RMQ_CLIENT } from './rabbitmq-client.token.js';

const STATS_GET_PATTERN = 'stats.get';

@ApiTags('stats')
@Controller('stats')
export class StatsController {
  public constructor(
    @Inject(SERVICE_B_RMQ_CLIENT) private readonly serviceBClient: ClientProxy,
    private readonly requestContextService: RequestContextService,
    @Inject(rabbitmqConfig.KEY)
    private readonly rabbitmqConfiguration: ConfigType<typeof rabbitmqConfig>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get processing statistics, optionally scoped to one import' })
  @ApiQuery({ name: 'importId', required: false, description: 'Import run UUID' })
  @ApiOkResponse({ type: StatsResponseDto })
  public async getStats(@Query() query: GetStatsQueryDto): Promise<StatsResponseDto> {
    const headers = buildOutboundHeaders(this.requestContextService.requireContext());
    const record = new RmqRecordBuilder(query).setOptions({ headers }).build();

    const result = await firstValueFrom(
      this.serviceBClient
        .send<IStatsView>(STATS_GET_PATTERN, record)
        .pipe(timeout(this.rabbitmqConfiguration.rpcTimeoutMs)),
    );

    return new StatsResponseDto(result);
  }
}
```

- [ ] **Step 2: Lint both Task 11 and Task 12 files together**

Run: `pnpm --filter api-gateway lint`
Expected: PASS.

- [ ] **Step 3: Stage the file**

```bash
git add back-end/api-gateway/src/stats/stats.controller.ts
```

---

## Task 13: `api-gateway` — `StatsController` integration test

**Files:**
- Create: `back-end/api-gateway/src/stats/stats.controller.int.spec.ts`

**Interfaces:**
- Consumes: `StatsModule` (Task 11), `SERVICE_B_RMQ_CLIENT` (Task 11), `AuthGuard`/`AuthModule` (existing),
  `rabbitmqConfig` (existing).

- [ ] **Step 1: Write the failing integration tests**

`back-end/api-gateway/src/stats/stats.controller.int.spec.ts`:
```ts
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { Test, type TestingModule } from '@nestjs/testing';
import loggerConfig from '@task1/shared/config/logger.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/http/exception-handling.module';
import { RequestContextModule } from '@task1/shared/request-context/http/request-context.module';
import { of } from 'rxjs';
import request from 'supertest';

import { AuthGuard } from '../auth/auth.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import rabbitmqConfig from '../config/rabbitmq.config.js';

import { SERVICE_B_RMQ_CLIENT } from './rabbitmq-client.token.js';
import { StatsModule } from './stats.module.js';

type App = Parameters<typeof request>[0];

describe('StatsController (HTTP Integration)', () => {
  let app: INestApplication;
  let httpServer: App;
  let serviceBClient: { send: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    serviceBClient = { send: vi.fn() };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [rabbitmqConfig, loggerConfig],
        }),
        RequestContextModule,
        ExceptionHandlingModule,
        AuthModule,
        StatsModule,
      ],
    })
      .overrideProvider(SERVICE_B_RMQ_CLIENT)
      .useValue(serviceBClient as unknown as ClientProxy)
      .overrideProvider(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
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

  describe('GET /stats', () => {
    const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

    it('should return 200 with aggregate stats, when no importId is given', async () => {
      serviceBClient.send.mockReturnValue(
        of({
          archivesProcessed: 12,
          eventsProcessed: 48_000,
          successfulEvents: 47_500,
          invalidEvents: 500,
          errors: 3,
          processingDurationMs: 15_230,
          timeSeries: [{ timestamp: '2026-08-11T00:00:00.000Z', value: 100 }],
        }),
      );

      const response = await request(httpServer).get('/stats');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        archivesProcessed: 12,
        eventsProcessed: 48_000,
        successfulEvents: 47_500,
        invalidEvents: 500,
        errors: 3,
        processingDurationMs: 15_230,
        timeSeries: [{ timestamp: '2026-08-11T00:00:00.000Z', value: 100 }],
      });
    });

    it('should return 200 without processingDurationMs, when service-b omits it', async () => {
      serviceBClient.send.mockReturnValue(
        of({
          archivesProcessed: 0,
          eventsProcessed: 0,
          successfulEvents: 0,
          invalidEvents: 0,
          errors: 0,
          timeSeries: [],
        }),
      );

      const response = await request(httpServer).get('/stats');

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('processingDurationMs');
    });

    it('should forward importId inside the RMQ message, when provided', async () => {
      serviceBClient.send.mockReturnValue(
        of({
          archivesProcessed: 1,
          eventsProcessed: 1,
          successfulEvents: 1,
          invalidEvents: 0,
          errors: 0,
          timeSeries: [],
        }),
      );

      await request(httpServer).get('/stats').query({ importId });

      const [pattern, record] = serviceBClient.send.mock.calls[0] as [
        string,
        { data: { importId: string } },
      ];
      expect(pattern).toBe('stats.get');
      expect(record.data).toEqual({ importId });
    });

    it('should send a message record whose headers include a correlation id, when a request is made', async () => {
      serviceBClient.send.mockReturnValue(
        of({
          archivesProcessed: 0,
          eventsProcessed: 0,
          successfulEvents: 0,
          invalidEvents: 0,
          errors: 0,
          timeSeries: [],
        }),
      );

      await request(httpServer).get('/stats');

      const [, record] = serviceBClient.send.mock.calls[0] as [
        string,
        { options: { headers: Record<string, string> } },
      ];
      expect(typeof record.options.headers['x-correlation-id']).toBe('string');
    });

    it('should return 400 and not call service-b, when importId is not a uuid', async () => {
      const response = await request(httpServer).get('/stats').query({ importId: 'not-a-uuid' });

      expect(response.status).toBe(400);
      expect(serviceBClient.send).not.toHaveBeenCalled();
    });

    it('should return 400 and not call service-b, when an unknown query parameter is provided', async () => {
      const response = await request(httpServer).get('/stats').query({ unknown: 'value' });

      expect(response.status).toBe(400);
      expect(serviceBClient.send).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail (if run before Tasks 11/12 exist)**

Run: `pnpm --filter api-gateway test -- stats.controller.int.spec.ts`
Expected: FAIL (module not found) until Tasks 11/12 exist.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm --filter api-gateway test -- stats.controller.int.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 4: Lint**

Run: `pnpm --filter api-gateway lint`
Expected: PASS.

- [ ] **Step 5: Stage the file**

```bash
git add back-end/api-gateway/src/stats/stats.controller.int.spec.ts
```

---

## Task 14: `api-gateway` — wire `StatsModule` into `app.module.ts`

**Files:**
- Modify: `back-end/api-gateway/src/app.module.ts`

**Interfaces:** none new — pure wiring.

- [ ] **Step 1: Update `app.module.ts`**

Replace the full contents of `back-end/api-gateway/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import loggerConfig from '@task1/shared/config/logger.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/http/exception-handling.module';
import { LoggerModule } from '@task1/shared/logger/http/logger.module';
import { RequestContextModule } from '@task1/shared/request-context/http/request-context.module';

import { AuthModule } from './auth/auth.module.js';
import appConfig from './config/app.config.js';
import mongodbConfig from './config/mongodb.config.js';
import rabbitmqConfig from './config/rabbitmq.config.js';
import redisConfig from './config/redis.config.js';
import storageConfig from './config/storage.config.js';
import uploadConfig from './config/upload.config.js';
import { EventsModule } from './events/events.module.js';
import { HealthModule } from './health/health.module.js';
import { ImportsModule } from './imports/imports.module.js';
import { StatsModule } from './stats/stats.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [
        appConfig,
        loggerConfig,
        rabbitmqConfig,
        mongodbConfig,
        redisConfig,
        storageConfig,
        uploadConfig,
      ],
    }),
    RequestContextModule,
    LoggerModule,
    ExceptionHandlingModule,
    AuthModule,
    HealthModule,
    ImportsModule,
    EventsModule,
    StatsModule,
  ],
})
export class AppModule {}
```

**Note:** this task wires only `StatsModule` (this phase's scope). `LogsModule` remains unwired — that gap
predates this phase (Phase 7's gateway wiring, Tasks 10–13 of
`docs/superpowers/plans/2026-08-13-phase-7-log-query-api.md`, was never executed even though `service-b`'s
side of Phase 7 is complete) and is out of scope for Phase 8 to fix silently; call it out to the user
rather than bundling an unrelated fix into this change.

- [ ] **Step 2: Run the full gateway test suite**

Run: `pnpm --filter api-gateway test`
Expected: PASS (all existing tests plus this phase's new ones).

- [ ] **Step 3: Lint**

Run: `pnpm --filter api-gateway lint`
Expected: PASS.

- [ ] **Step 4: Stage the file**

```bash
git add back-end/api-gateway/src/app.module.ts
```

---

## Task 15: End-to-end verification

**Files:** none — this task only runs commands and reads output, the "does everything actually connect"
checkpoint the earlier mocked unit/integration tests can't cover.

- [ ] **Step 1: Build all workspace packages**

Run: `pnpm build`
Expected: succeeds for `@task1/shared`, `service-a`, `service-b`, `api-gateway`, `front-end`.

- [ ] **Step 2: Run every touched package's test suite**

Run: `pnpm --filter service-b test && pnpm --filter api-gateway test`
Expected: both PASS.

- [ ] **Step 3: Lint every touched package**

Run: `pnpm --filter service-b lint && pnpm --filter api-gateway lint`
Expected: both PASS.

- [ ] **Step 4: Start the full stack**

Run: `pnpm docker:up`
Expected: all containers reach a healthy/running state.

- [ ] **Step 5: Confirm the stats endpoint is reachable**

Run:
```bash
curl -s "http://localhost:3000/api/v1/stats"
```
Expected: a JSON body shaped `{"archivesProcessed":0,"eventsProcessed":0,"successfulEvents":0,
"invalidEvents":0,"errors":0,"timeSeries":[]}` if no import has run yet — **not** a 403 (the gateway's
`AuthGuard` currently denies all non-`@Public()` routes unconditionally; a 403 here is the current,
expected, documented behavior of the fail-closed auth stub, not a bug in this phase, matching Phase 7's
precedent).

- [ ] **Step 6: Tear down**

Run: `pnpm docker:down`
Expected: all containers stop cleanly.

---

## Self-Review

**Spec coverage:** the design doc's "Service-b: processing statistics API (Phase 8)" section maps entirely
to Tasks 1–14: `GET /v1/stats?importId=...` with the "aggregate across all imports if omitted" behavior
(Tasks 9, 12), "computed via a MongoDB aggregation pipeline over processing-logs (group by status, sum
counters)" (Tasks 2, 3, 6), "plus optional TS.RANGE reads from RedisTimeSeries for time-bucketed charts"
(Tasks 1, 5, 6), and "never fetches raw historical logs into Node to compute this by hand" (the aggregation
never returns more than 3 grouped documents; the single-import path fetches at most 3 raw documents, never
a bulk scan — Task 4/6). The roadmap's `StatsResult { archivesProcessed, eventsProcessed, successfulEvents,
invalidEvents, processingDurationMs, errors }` shape plus a `timeSeries` field is produced unchanged by
`get-stats.ts` (Task 6) for `StatsService`/`StatsController` (Task 7) to return as-is, ready for Phase 9 to
reuse.

**Placeholder scan:** no TBD/TODO; every step shows complete file contents or an exact runnable command
with expected output.

**Type/name consistency:** `IStatsGroup` (Task 3) is produced by the pipeline `buildStatsPipeline` (Task 2)
builds and consumed unchanged by `shapeStats` (Task 3) and `get-stats.ts`'s `collection.aggregate<IStatsGroup>`
call (Task 6). `IImportTimeSeriesPoint` (Task 4) is consumed unchanged by `StatsMetricsReader` (Task 5) and
`get-stats.ts` (Task 6) — both produce the same point shape whether it comes from Redis or from Mongo
timestamps. `IStatsResult` (Task 6) is consumed unchanged by `StatsService` (Task 7) and is the shape
`StatsController.handleGetStats` (Task 7) returns. On the gateway side, `GetStatsQueryDto`'s (Task 9) one
field (`importId`) matches `GetStatsMessage`'s (Task 7) exactly, so service-b's Zod schema validates
exactly what the gateway sends, with no field-name translation layer. `IStatsView` (Task 10) is the one
shared contract between the gateway's `StatsResponseDto` constructor and its `StatsController` RPC reply
type (Task 12), field-for-field identical to service-b's `IStatsResult` (no `Date`-to-`string` translation
needed here, unlike Phase 7's `timestamp` field, since every field in this shape is already a plain number
or an ISO string). The RPC pattern string `'stats.get'` is identical in `StatsController` (service-b, Task
7) and `StatsController` (gateway, Task 12).

**Cross-service boundary:** `IProcessingLogDocument` stays service-b-internal (never imported by the
gateway); the gateway declares `IStatsView` independently — consistent with Phase 6/7's decision and
`CLAUDE.md`'s module-boundary rule. `StatsService`/`StatsMetricsReader` stay inside `ProcessingLogModule`
(Task 8) rather than a new top-level `service-b` module, since they read the collection `ProcessingLogModule`
owns — consistent with `CLAUDE.md`'s "Database access belongs only to the owning module" rule, and a
tighter application of it than Phase 7 needed to state explicitly (Phase 7 already put `search/` inside
`processing-log/` for the same reason).

**Known pre-existing gap surfaced, not silently fixed:** `back-end/api-gateway/src/logs/logs.module.ts`,
`logs.controller.ts`, `logs.controller.int.spec.ts`, and `LogsModule`'s registration in `app.module.ts`
(Phase 7's Tasks 10–13) do not exist in the current codebase, even though every other part of Phase 7 is
implemented and passing. `GET /v1/logs` is therefore not currently reachable through the gateway. This is
unrelated to Phase 8's scope (`StatsModule` doesn't depend on `LogsModule`) and is called out here rather
than bundled into this plan, per `CLAUDE.md`'s "no unrelated refactoring" — closing it should be its own
small follow-up finishing Phase 7's Tasks 10–13 as originally written.
