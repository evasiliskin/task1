# Phase 7: Service-b Log Query API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /v1/logs` (gateway) — filters the `processing-logs` documents `service-b` already stores
(from Phase 6) by `importId`/`status`/`from`/`to` and paginates via an opaque keyset cursor, forwarding
the request as a small DTO over the existing RMQ RPC pattern (`ClientProxy.send`) to `service-b`, which
builds a MongoDB filter and queries with `{timestamp, _id}` keyset pagination — never `skip()`, never
loading more than one page's worth of documents into Node.

**Architecture:** A new `back-end/service-b/src/processing-log/search/` subfolder (mirroring service-a's
`archive/search/` layout from Phase 4) holds the pure step functions — `log-cursor.util.ts` (opaque
cursor encode/decode), `build-logs-filter.ts` (pure Mongo filter builder), `search-logs-message.schema.ts`
(Zod validation for the inbound RMQ payload), `search-logs.ts` (orchestration) — plus `LogsSearchService`
(injects the existing `PROCESSING_LOG_COLLECTION` token from Phase 6) and a `LogsSearchController`
(`@MessagePattern('logs.search')`), added to the existing `ProcessingLogModule`. On the gateway side, a
new `back-end/api-gateway/src/logs/` module owns `GET /logs`: a class-validator `SearchLogsQueryDto`, a
module-scoped `SERVICE_B_RMQ_CLIENT` (duplicating the pattern the `EventsModule` established in Phase 4),
and a `LogsController` that calls `ClientProxy.send()` with an `RmqRecordBuilder`-wrapped payload carrying
propagated correlation headers, exactly like `EventsController`.

**Tech Stack:** `@nestjs/microservices` (`ClientProxy.send`, `@MessagePattern`, `@Ctx`, `RmqContext`), Zod
(service-b inbound message validation), `class-validator`/`class-transformer` (gateway query DTO), official
`mongodb` driver v7 (`Collection.find().sort().limit().toArray()`, `ObjectId`, `WithId`, dotted-path
filter keys), Vitest.

**Design doc:** `docs/superpowers/specs/2026-08-12-github-archive-platform-design.md` (section
"Service-b: log query API (Phase 7)", plus the `processing-logs` fields in "Service-b: RabbitMQ consumer
& processing-log storage (Phase 6)").
**Roadmap:** `docs/superpowers/plans/2026-08-12-github-archive-platform-plan.md` (Phase 7 of 11).
**Depends on:** Phase 6 (`IProcessingLogDocument`/`ProcessingLogStatus`, `PROCESSING_LOG_COLLECTION`,
`ensureProcessingLogIndexes` + its initializer already called at `OnModuleInit`, `ProcessingLogModule`,
the manual-ack transport in `service-b`'s `main.ts`), Phase 4 (the gateway's `rabbitmqConfig().rpcTimeoutMs`
— already shipped, needs no change here — and the `EventsModule`/`events.controller.ts` pattern this
phase's `LogsModule`/`LogsController` mirror).

Every file path, existing convention, and framework detail below was verified by reading this exact
repository's current state (post-Phase-6) before this plan was written. Two non-obvious findings are
called out in Global Constraints below because implementing this phase naively would either leak
persistence internals or silently break service-b's message acknowledgement.

## Global Constraints

- **Finding 1 — service-b runs with `noAck: false` (manual acknowledgement), so the new request/reply
  `logs.search` handler MUST ack the message itself.** Unlike service-a's Phase 4 `EventsSearchController`
  (which runs under the default `noAck: true` auto-ack and never touches the channel), `service-b`'s
  `main.ts` was switched to `noAck: false` in Phase 6 (verified: `back-end/service-b/src/main.ts` passes
  `noAck: false, prefetchCount` to `createMicroservice`). Under `noAck: false`, **every** handler on the
  microservice — including `@MessagePattern` request/reply handlers — must call
  `context.getChannelRef().ack(context.getMessage())`, or its message (and, once `prefetchCount` messages
  are stuck unacked, every subsequent message) is never acknowledged. `HealthController.check` already
  does exactly this. `LogsSearchController.handleSearch` therefore acks in a `finally` block so the message
  is acked whether the search succeeds or a validation/query error propagates back to the gateway as an
  RPC error reply — the `@typescript-eslint/return-await: ['error', 'always']` rule already forces the
  `return await` inside the `try` that makes this correct.
- **Finding 2 — the keyset tiebreaker is Mongo's `_id`, so `search-logs.ts` cannot use a `{_id: 0}`
  projection the way service-a's `search-events.ts` did.** The design doc's Phase 7 default index is
  `{timestamp: -1, _id: -1}`, and `processing-logs` has no single business-unique field to sort on
  (`{importId, status}` is unique but two-field). So `searchLogs` queries **without** excluding `_id`
  (it needs `_id` to build the next cursor from the last returned document), then maps each returned
  `WithId<IProcessingLogDocument>` through an explicit `toLogEntry` function that copies only the business
  fields — never `_id` — into the outbound `data`. This keeps `CLAUDE.md`'s "Persistence models never
  leave the persistence boundary" rule true (no `_id`, no `ObjectId`, ever crosses RMQ) while still
  supporting `_id`-based keyset pagination. The cursor encodes `_id` as its 24-char hex string; the filter
  reconstructs it with `new ObjectId(hex)`.
- **`IProcessingLogDocument` stays service-b-internal — it is NOT added to `@task1/shared`.** Phase 6
  deliberately kept this type service-b-local ("never exported from `@task1/shared`: this collection is
  never read by another service"). The gateway therefore does **not** import it; it declares its own
  response contract (`ILogEntryView` in `log-response.dto.ts`) and types the RMQ reply against that.
  This matches `CLAUDE.md`'s module-boundary rule ("Never access another module's persistence models") —
  the gateway owns serialization, service-b owns persistence.
- **This phase adds the three query-pattern indexes the design doc's Phase 7 section defers to it**
  (`{importId:1, timestamp:-1}`, `{status:1, timestamp:-1}`, default `{timestamp:-1, _id:-1}`) alongside
  Phase 6's existing `{importId:1, status:1}` unique index — all in the same `ensureProcessingLogIndexes`
  function, which `EnsureProcessingLogIndexesInitializer` already calls at `OnModuleInit`, so no new
  startup wiring is needed, only the function body growing. `_id` and dotted keys as object-literal index
  spec keys do not trigger `security/detect-object-injection` (that rule targets variable-derived bracket
  keys, not literal keys — confirmed by Phase 4's Finding 1).
- **The cursor is an opaque, server-only-decodable string** (base64url of `{timestamp: ISO string, id:
  24-hex}`). The client (frontend, Swagger caller) never constructs or inspects one — it only passes back
  whatever `nextCursor` it was given. `log-cursor.util.ts` lives inside service-b's own
  `processing-log/search/` folder, not `@task1/shared` — it is a separate implementation from service-a's
  `event-cursor.util.ts` (matching this repo's established no-cross-service-imports module boundary).
- Never throw raw `Error` — `InvalidCursorError` (new,
  `back-end/service-b/src/processing-log/search/errors.ts`) extends `ValidationError` from
  `@task1/shared/errors/index`, using its static `buildOptions` helper, matching service-a's
  `InvalidCursorError` from Phase 4 exactly (a caller-input problem, not an external-dependency failure).
- `LogsModule` (gateway) registers its **own** `SERVICE_B_RMQ_CLIENT` via `ClientsModule.registerAsync`,
  under its own `logs/rabbitmq-client.token.ts` — the same module-scoped duplication `EventsModule`,
  `HealthModule`, and `ImportsModule` already use (string DI tokens are module-scoped, so the identical
  `'SERVICE_B_RMQ_CLIENT'` string in `HealthModule`'s `rabbitmq-clients.tokens.ts` does not collide — each
  module resolves its own registration). Consolidating these into one shared registration is a
  cross-cutting refactor of existing working code, out of scope here (`CLAUDE.md`'s "no unrelated
  refactoring"). Independent AMQP connections to the same queue remain an accepted, documented trade-off.
- Zod validates the inbound RMQ message shape (`search-logs-message.schema.ts`, matching Phase 4's
  `search-events-message.schema.ts`); `class-validator`/`class-transformer` validate the gateway's HTTP
  query params (`SearchLogsQueryDto`) — each service keeps using the validation library already
  established at its own boundary.
- `unicorn/prevent-abbreviations` rejects short names — full words throughout (allowlist:
  `Dto`/`dto`/`req`/`res`/`E2e`/`e2e`, per `eslint.config.mjs`).
- Type-only imports use inline `type` modifiers; relative imports use explicit `.js` extensions; imports
  grouped (builtin/external/internal/parent/sibling/index), alphabetized ascending case-insensitive, blank
  line between groups.
- Naming: `interface`s are `PascalCase` prefixed with `I` (`ILogCursor`, `ILogEntryView`). `type` aliases
  are `PascalCase` with no prefix (`SearchLogsMessage`, `SearchLogsResult`). Blank line required before
  every `return`/`throw` following a statement, and before every `if`.
- `vitest` globals (`describe`/`it`/`expect`/`vi`/`beforeAll`/`beforeEach`/`afterAll`/`afterEach`) are
  available without import (`vitest.config.ts` sets `globals: true`, and `eslint.config.mjs` declares them
  as spec globals) — do NOT import them in spec files, matching the dominant convention
  (`import-events.controller.spec.ts`, `events.controller.int.spec.ts`).
- BDD test naming: `it('should X, when Y')`. Coverage thresholds: 90% lines, 90% branches.
- Mocking convention: plain object literal matching only the members under test, cast with
  `as unknown as <RealType>` — never `vi.mock()`. Direct class instantiation (`new X(...)`) over
  `Test.createTestingModule()` when Nest DI is not itself under test (gateway integration tests are the
  exception — they use `Test.createTestingModule()` + `supertest`).
- Real UUID-shaped literals in test fixtures: `a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11` (importId),
  `b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11` (correlationId), reusing Phase 5/6's literals. Real 24-hex
  ObjectId literals for `_id`: `64b7f0c2f1a2b3c4d5e6f7a1` / `64b7f0c2f1a2b3c4d5e6f7a2` /
  `64b7f0c2f1a2b3c4d5e6f7a3`.
- No dedicated `*.spec.ts` for `search/errors.ts` — matches the repo's `errors.ts` convention;
  `InvalidCursorError`'s throw behavior is exercised indirectly by `log-cursor.util.spec.ts`.
- No `git commit` in any step — every checkpoint is written as "stage the files"; the user commits.

---

## Task 1: `service-b` — extend `ensureProcessingLogIndexes` with the query/pagination indexes

**Files:**
- Modify: `back-end/service-b/src/processing-log/ensure-processing-log-indexes.ts`
- Modify: `back-end/service-b/src/processing-log/ensure-processing-log-indexes.spec.ts`

**Interfaces:**
- Produces: `ensureProcessingLogIndexes(collection: Collection<IProcessingLogDocument>): Promise<void>` —
  unchanged signature, now creates four indexes total: the existing `{importId:1, status:1}` unique index
  (Phase 6), plus `{importId:1, timestamp:-1}`, `{status:1, timestamp:-1}`, and `{timestamp:-1, _id:-1}`
  (default pagination), per the design doc's Phase 7 section.
- Consumed by: `EnsureProcessingLogIndexesInitializer` (Phase 6, already calls this at `OnModuleInit` — no
  change there), Task 5 (`searchLogs`'s query relies on these indexes at runtime).

- [ ] **Step 1: Replace the spec with assertions for all four indexes**

Replace the full contents of `back-end/service-b/src/processing-log/ensure-processing-log-indexes.spec.ts`:
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

  it('should create the importId filter index, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('importId_1_timestamp_-1');
    const collection = { createIndex } as unknown as Collection<IProcessingLogDocument>;

    await ensureProcessingLogIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ importId: 1, timestamp: -1 });
  });

  it('should create the status filter index, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('status_1_timestamp_-1');
    const collection = { createIndex } as unknown as Collection<IProcessingLogDocument>;

    await ensureProcessingLogIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ status: 1, timestamp: -1 });
  });

  it('should create the default pagination index, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('timestamp_-1__id_-1');
    const collection = { createIndex } as unknown as Collection<IProcessingLogDocument>;

    await ensureProcessingLogIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ timestamp: -1, _id: -1 });
  });

  it('should create exactly four indexes, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('index');
    const collection = { createIndex } as unknown as Collection<IProcessingLogDocument>;

    await ensureProcessingLogIndexes(collection);

    expect(createIndex).toHaveBeenCalledTimes(4);
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `pnpm --filter service-b test -- ensure-processing-log-indexes.spec.ts`
Expected: FAIL — only the unique-index `createIndex` call exists so far; the three new index assertions
and the "exactly four indexes" assertion fail.

- [ ] **Step 3: Implement the three additional indexes**

Replace the full contents of `back-end/service-b/src/processing-log/ensure-processing-log-indexes.ts`:
```ts
import { type Collection } from 'mongodb';

import { type IProcessingLogDocument } from './processing-log.types.js';

export async function ensureProcessingLogIndexes(
  collection: Collection<IProcessingLogDocument>,
): Promise<void> {
  await collection.createIndex({ importId: 1, status: 1 }, { unique: true });
  await collection.createIndex({ importId: 1, timestamp: -1 });
  await collection.createIndex({ status: 1, timestamp: -1 });
  await collection.createIndex({ timestamp: -1, _id: -1 });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter service-b test -- ensure-processing-log-indexes.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the initializer spec to confirm no regression**

Run: `pnpm --filter service-b test -- ensure-processing-log-indexes-initializer.service.spec.ts`
Expected: PASS (2 tests, unchanged — that spec asserts `createIndex` was called with the `{importId:1,
status:1}` args among however many calls happen, so it stays green).

- [ ] **Step 6: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 7: Stage the files**

```bash
git add back-end/service-b/src/processing-log/ensure-processing-log-indexes.ts back-end/service-b/src/processing-log/ensure-processing-log-indexes.spec.ts
```

---

## Task 2: `service-b` — log cursor codec and its error type

**Files:**
- Create: `back-end/service-b/src/processing-log/search/errors.ts`
- Create: `back-end/service-b/src/processing-log/search/log-cursor.util.ts`
- Create: `back-end/service-b/src/processing-log/search/log-cursor.util.spec.ts`

**Interfaces:**
- Produces: `InvalidCursorError extends ValidationError` (constructor `(cursor: string, cause?: Error)`,
  code `'INVALID_CURSOR'`, category `VALIDATION`, `params: { cursor }`).
- Produces: `ILogCursor { timestamp: Date; id: string }`, `encodeLogCursor(cursor: ILogCursor): string`
  (base64url of a small JSON payload), `decodeLogCursor(cursor: string): ILogCursor` (throws
  `InvalidCursorError` on any malformed input — bad base64, non-JSON payload, bad timestamp, or an `id`
  that is not a 24-char hex string).
- Consumed by: Task 4 (`build-logs-filter.ts`), Task 5 (`search-logs.ts`).

- [ ] **Step 1: Create the error class (no test — matches this repo's `errors.ts` convention)**

`back-end/service-b/src/processing-log/search/errors.ts`:
```ts
import { ErrorCategory, ValidationError } from '@task1/shared/errors/index';

export class InvalidCursorError extends ValidationError {
  public constructor(cursor: string, cause?: Error) {
    super(
      'The provided cursor is not valid',
      InvalidCursorError.buildOptions({
        code: 'INVALID_CURSOR',
        category: ErrorCategory.VALIDATION,
        params: { cursor },
        ...(cause === undefined ? {} : { cause }),
      }),
    );
  }
}
```

- [ ] **Step 2: Write the failing tests for the cursor codec**

`back-end/service-b/src/processing-log/search/log-cursor.util.spec.ts`:
```ts
import { InvalidCursorError } from './errors.js';
import { decodeLogCursor, encodeLogCursor } from './log-cursor.util.js';

describe('encodeLogCursor / decodeLogCursor', () => {
  it('should round-trip timestamp and id, when a cursor is encoded then decoded', () => {
    const cursor = { timestamp: new Date('2026-08-11T00:00:00.000Z'), id: '64b7f0c2f1a2b3c4d5e6f7a1' };

    const decoded = decodeLogCursor(encodeLogCursor(cursor));

    expect(decoded.timestamp.toISOString()).toBe(cursor.timestamp.toISOString());
    expect(decoded.id).toBe(cursor.id);
  });

  it('should throw InvalidCursorError, when the cursor does not decode to valid JSON', () => {
    expect(() => decodeLogCursor('not-a-valid-cursor')).toThrow(InvalidCursorError);
  });

  it('should throw InvalidCursorError, when the decoded payload is missing id', () => {
    const payload = Buffer.from(
      JSON.stringify({ timestamp: '2026-08-11T00:00:00.000Z' }),
      'utf8',
    ).toString('base64url');

    expect(() => decodeLogCursor(payload)).toThrow(InvalidCursorError);
  });

  it('should throw InvalidCursorError, when timestamp is not an ISO datetime string', () => {
    const payload = Buffer.from(
      JSON.stringify({ timestamp: 'not-a-date', id: '64b7f0c2f1a2b3c4d5e6f7a1' }),
      'utf8',
    ).toString('base64url');

    expect(() => decodeLogCursor(payload)).toThrow(InvalidCursorError);
  });

  it('should throw InvalidCursorError, when id is not a 24-character hex string', () => {
    const payload = Buffer.from(
      JSON.stringify({ timestamp: '2026-08-11T00:00:00.000Z', id: 'not-hex' }),
      'utf8',
    ).toString('base64url');

    expect(() => decodeLogCursor(payload)).toThrow(InvalidCursorError);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- log-cursor.util.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `log-cursor.util.ts`**

`back-end/service-b/src/processing-log/search/log-cursor.util.ts`:
```ts
import { z } from 'zod';

import { InvalidCursorError } from './errors.js';

const cursorPayloadSchema = z.object({
  timestamp: z.iso.datetime(),
  id: z.string().regex(/^[0-9a-fA-F]{24}$/),
});

export interface ILogCursor {
  timestamp: Date;
  id: string;
}

export function encodeLogCursor(cursor: ILogCursor): string {
  const payload = JSON.stringify({
    timestamp: cursor.timestamp.toISOString(),
    id: cursor.id,
  });

  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeLogCursor(cursor: string): ILogCursor {
  let decodedPayload: unknown;

  try {
    decodedPayload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch (error) {
    throw new InvalidCursorError(cursor, error instanceof Error ? error : undefined);
  }

  const result = cursorPayloadSchema.safeParse(decodedPayload);

  if (!result.success) {
    throw new InvalidCursorError(cursor);
  }

  return { timestamp: new Date(result.data.timestamp), id: result.data.id };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- log-cursor.util.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 7: Stage the files**

```bash
git add back-end/service-b/src/processing-log/search/errors.ts back-end/service-b/src/processing-log/search/log-cursor.util.ts back-end/service-b/src/processing-log/search/log-cursor.util.spec.ts
```

---

## Task 3: `service-b` — inbound search message schema

**Files:**
- Create: `back-end/service-b/src/processing-log/search/search-logs-message.schema.ts`
- Create: `back-end/service-b/src/processing-log/search/search-logs-message.schema.spec.ts`

**Interfaces:**
- Produces: `searchLogsMessageSchema` (Zod), `type SearchLogsMessage = { importId?: string; status?:
  'started' | 'completed' | 'failed'; from?: string; to?: string; cursor?: string; limit: number }`
  (`limit` always present after parsing — defaults to 50, capped at 200). The `status` union matches
  `ProcessingLogStatus` from `processing-log.types.ts`.
- Consumed by: Task 4 (`build-logs-filter.ts`), Task 5 (`search-logs.ts`), Task 7 (`LogsSearchController`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-b/src/processing-log/search/search-logs-message.schema.spec.ts`:
```ts
import { searchLogsMessageSchema } from './search-logs-message.schema.js';

describe('searchLogsMessageSchema', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  it('should default limit to 50, when limit is omitted', () => {
    expect(searchLogsMessageSchema.parse({}).limit).toBe(50);
  });

  it('should accept every optional filter field, when all are present and well-formed', () => {
    const message = {
      importId,
      status: 'completed',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-11T00:00:00.000Z',
      cursor: 'some-cursor',
      limit: 25,
    };

    expect(searchLogsMessageSchema.parse(message)).toEqual(message);
  });

  it('should coerce a numeric-string limit, when it arrives as a string over the wire', () => {
    expect(searchLogsMessageSchema.parse({ limit: '25' }).limit).toBe(25);
  });

  it('should throw, when limit exceeds 200', () => {
    expect(() => searchLogsMessageSchema.parse({ limit: 201 })).toThrow();
  });

  it('should throw, when limit is zero or negative', () => {
    expect(() => searchLogsMessageSchema.parse({ limit: 0 })).toThrow();
  });

  it('should throw, when importId is not a uuid', () => {
    expect(() => searchLogsMessageSchema.parse({ importId: 'not-a-uuid' })).toThrow();
  });

  it('should throw, when status is not a known processing status', () => {
    expect(() => searchLogsMessageSchema.parse({ status: 'unknown' })).toThrow();
  });

  it('should throw, when from is not an ISO datetime string', () => {
    expect(() => searchLogsMessageSchema.parse({ from: 'not-a-date' })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- search-logs-message.schema.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `search-logs-message.schema.ts`**

`back-end/service-b/src/processing-log/search/search-logs-message.schema.ts`:
```ts
import { z } from 'zod';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export const searchLogsMessageSchema = z.object({
  importId: z.uuid().optional(),
  status: z.enum(['started', 'completed', 'failed']).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

export type SearchLogsMessage = z.infer<typeof searchLogsMessageSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- search-logs-message.schema.spec.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-b/src/processing-log/search/search-logs-message.schema.ts back-end/service-b/src/processing-log/search/search-logs-message.schema.spec.ts
```

---

## Task 4: `service-b` — Mongo filter builder

**Files:**
- Create: `back-end/service-b/src/processing-log/search/build-logs-filter.ts`
- Create: `back-end/service-b/src/processing-log/search/build-logs-filter.spec.ts`

**Interfaces:**
- Consumes: `type SearchLogsMessage` (Task 3), `type ILogCursor` (Task 2), `type IProcessingLogDocument`
  (Phase 6), `ObjectId`/`type Filter` (`mongodb`).
- Produces: `buildLogsFilter(message: SearchLogsMessage, cursor?: ILogCursor):
  Filter<IProcessingLogDocument>` — pure function. Maps `importId`→`importId`, `status`→`status` (direct
  equality each); `from`/`to`→a `timestamp` range (`$gte`/`$lte`, either or both); when a `cursor` is
  given, wraps everything in `$and: [<field filter>, {$or: [{timestamp: {$lt}}, {timestamp: eq, _id: {$lt:
  new ObjectId(cursor.id)}}]}]` — the descending-keyset shape matching the `{timestamp:-1, _id:-1}`
  sort/index from Task 1.
- Consumed by: Task 5 (`search-logs.ts`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-b/src/processing-log/search/build-logs-filter.spec.ts`:
```ts
import { ObjectId } from 'mongodb';

import { buildLogsFilter } from './build-logs-filter.js';

describe('buildLogsFilter', () => {
  const baseMessage = { limit: 50 };
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  it('should return an empty filter, when no filters or cursor are provided', () => {
    expect(buildLogsFilter(baseMessage)).toEqual({});
  });

  it('should filter by importId, when importId is provided', () => {
    expect(buildLogsFilter({ ...baseMessage, importId })).toEqual({ importId });
  });

  it('should filter by status, when status is provided', () => {
    expect(buildLogsFilter({ ...baseMessage, status: 'completed' })).toEqual({ status: 'completed' });
  });

  it('should filter timestamp with only $gte, when only from is provided', () => {
    expect(buildLogsFilter({ ...baseMessage, from: '2026-08-01T00:00:00.000Z' })).toEqual({
      timestamp: { $gte: new Date('2026-08-01T00:00:00.000Z') },
    });
  });

  it('should filter timestamp with both $gte and $lte, when from and to are both provided', () => {
    expect(
      buildLogsFilter({
        ...baseMessage,
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-11T00:00:00.000Z',
      }),
    ).toEqual({
      timestamp: {
        $gte: new Date('2026-08-01T00:00:00.000Z'),
        $lte: new Date('2026-08-11T00:00:00.000Z'),
      },
    });
  });

  it('should combine every provided filter field, when all are present', () => {
    expect(buildLogsFilter({ ...baseMessage, importId, status: 'failed' })).toEqual({
      importId,
      status: 'failed',
    });
  });

  it('should wrap the filter in a keyset $and/$or clause, when a cursor is provided', () => {
    const cursorTimestamp = new Date('2026-08-11T00:00:00.000Z');
    const cursorId = '64b7f0c2f1a2b3c4d5e6f7a1';

    expect(
      buildLogsFilter({ ...baseMessage, status: 'completed' }, { timestamp: cursorTimestamp, id: cursorId }),
    ).toEqual({
      $and: [
        { status: 'completed' },
        {
          $or: [
            { timestamp: { $lt: cursorTimestamp } },
            { timestamp: cursorTimestamp, _id: { $lt: new ObjectId(cursorId) } },
          ],
        },
      ],
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- build-logs-filter.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `build-logs-filter.ts`**

`back-end/service-b/src/processing-log/search/build-logs-filter.ts`:
```ts
import { type Filter, ObjectId } from 'mongodb';

import { type IProcessingLogDocument } from '../processing-log.types.js';

import { type ILogCursor } from './log-cursor.util.js';
import { type SearchLogsMessage } from './search-logs-message.schema.js';

export function buildLogsFilter(
  message: SearchLogsMessage,
  cursor?: ILogCursor,
): Filter<IProcessingLogDocument> {
  const filter: Filter<IProcessingLogDocument> = {};

  if (message.importId !== undefined) {
    filter.importId = message.importId;
  }

  if (message.status !== undefined) {
    filter.status = message.status;
  }

  if (message.from !== undefined || message.to !== undefined) {
    filter.timestamp = {
      ...(message.from === undefined ? {} : { $gte: new Date(message.from) }),
      ...(message.to === undefined ? {} : { $lte: new Date(message.to) }),
    };
  }

  if (cursor === undefined) {
    return filter;
  }

  return {
    $and: [
      filter,
      {
        $or: [
          { timestamp: { $lt: cursor.timestamp } },
          { timestamp: cursor.timestamp, _id: { $lt: new ObjectId(cursor.id) } },
        ],
      },
    ],
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- build-logs-filter.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-b/src/processing-log/search/build-logs-filter.ts back-end/service-b/src/processing-log/search/build-logs-filter.spec.ts
```

---

## Task 5: `service-b` — `searchLogs` orchestration function

**Files:**
- Create: `back-end/service-b/src/processing-log/search/search-logs.ts`
- Create: `back-end/service-b/src/processing-log/search/search-logs.spec.ts`

**Interfaces:**
- Consumes: `buildLogsFilter` (Task 4), `decodeLogCursor`/`encodeLogCursor` (Task 2), `type
  SearchLogsMessage` (Task 3), `type IProcessingLogDocument` (Phase 6), `type Collection`/`type WithId`
  (`mongodb`).
- Produces: `type SearchLogsResult = { data: IProcessingLogDocument[]; nextCursor?: string }`,
  `searchLogs(collection: Collection<IProcessingLogDocument>, message: SearchLogsMessage):
  Promise<SearchLogsResult>` — decodes `message.cursor` if present, builds the filter, queries `limit + 1`
  documents sorted `{timestamp:-1, _id:-1}`, maps each returned `WithId` document through `toLogEntry`
  (copies only business fields — `_id` never leaves), returns the first `limit` entries plus a
  `nextCursor` derived from the last page document's `{timestamp, _id.toHexString()}` **only** when the
  `limit + 1`th document existed.
- Consumed by: Task 6 (`LogsSearchService`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-b/src/processing-log/search/search-logs.spec.ts`:
```ts
import { ObjectId, type Collection, type WithId } from 'mongodb';

import { type IProcessingLogDocument } from '../processing-log.types.js';

import { encodeLogCursor } from './log-cursor.util.js';
import { searchLogs } from './search-logs.js';

describe('searchLogs', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const correlationId = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  function buildDocument(hexId: string, timestamp: string): WithId<IProcessingLogDocument> {
    return {
      _id: new ObjectId(hexId),
      importId,
      eventType: 'github.import.completed',
      service: 'service-a',
      status: 'completed',
      timestamp: new Date(timestamp),
      correlationId,
      archive: '2026-08-11-0.json.gz',
      metadata: { eventsProcessed: 10 },
    };
  }

  function buildCollection(documents: Array<WithId<IProcessingLogDocument>>): {
    collection: Collection<IProcessingLogDocument>;
    find: ReturnType<typeof vi.fn>;
    cursor: { sort: ReturnType<typeof vi.fn>; limit: ReturnType<typeof vi.fn> };
  } {
    const cursor = {
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(documents),
    };
    const find = vi.fn().mockReturnValue(cursor);

    return { collection: { find } as unknown as Collection<IProcessingLogDocument>, find, cursor };
  }

  it('should return every entry without _id and no nextCursor, when fewer documents exist than the limit', async () => {
    const documents = [buildDocument('64b7f0c2f1a2b3c4d5e6f7a1', '2026-08-11T00:02:00.000Z')];
    const { collection } = buildCollection(documents);

    const result = await searchLogs(collection, { limit: 50 });

    expect(result.nextCursor).toBeUndefined();
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).not.toHaveProperty('_id');
    expect(result.data[0]).toEqual({
      importId,
      eventType: 'github.import.completed',
      service: 'service-a',
      status: 'completed',
      timestamp: new Date('2026-08-11T00:02:00.000Z'),
      correlationId,
      archive: '2026-08-11-0.json.gz',
      metadata: { eventsProcessed: 10 },
    });
  });

  it('should return a nextCursor derived from the last returned document, when more documents exist than the limit', async () => {
    const documents = [
      buildDocument('64b7f0c2f1a2b3c4d5e6f7a1', '2026-08-11T00:02:00.000Z'),
      buildDocument('64b7f0c2f1a2b3c4d5e6f7a2', '2026-08-11T00:01:00.000Z'),
      buildDocument('64b7f0c2f1a2b3c4d5e6f7a3', '2026-08-11T00:00:00.000Z'),
    ];
    const { collection } = buildCollection(documents);

    const result = await searchLogs(collection, { limit: 2 });

    expect(result.data).toHaveLength(2);
    expect(result.nextCursor).toBe(
      encodeLogCursor({
        timestamp: new Date('2026-08-11T00:01:00.000Z'),
        id: '64b7f0c2f1a2b3c4d5e6f7a2',
      }),
    );
  });

  it('should query with limit + 1 sorted by timestamp/_id descending, when called', async () => {
    const { collection, find, cursor } = buildCollection([]);

    await searchLogs(collection, { limit: 50 });

    expect(find).toHaveBeenCalledWith({});
    expect(cursor.sort).toHaveBeenCalledWith({ timestamp: -1, _id: -1 });
    expect(cursor.limit).toHaveBeenCalledWith(51);
  });

  it('should decode the cursor and build a keyset filter, when a cursor is provided', async () => {
    const { collection, find } = buildCollection([]);
    const priorTimestamp = new Date('2026-08-11T00:00:00.000Z');
    const priorId = '64b7f0c2f1a2b3c4d5e6f7a3';
    const priorCursor = encodeLogCursor({ timestamp: priorTimestamp, id: priorId });

    await searchLogs(collection, { limit: 50, cursor: priorCursor });

    expect(find).toHaveBeenCalledWith({
      $and: [
        {},
        {
          $or: [
            { timestamp: { $lt: priorTimestamp } },
            { timestamp: priorTimestamp, _id: { $lt: new ObjectId(priorId) } },
          ],
        },
      ],
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- search-logs.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `search-logs.ts`**

`back-end/service-b/src/processing-log/search/search-logs.ts`:
```ts
import { type Collection, type WithId } from 'mongodb';

import { type IProcessingLogDocument } from '../processing-log.types.js';

import { buildLogsFilter } from './build-logs-filter.js';
import { decodeLogCursor, encodeLogCursor } from './log-cursor.util.js';
import { type SearchLogsMessage } from './search-logs-message.schema.js';

export type SearchLogsResult = {
  data: IProcessingLogDocument[];
  nextCursor?: string;
};

export async function searchLogs(
  collection: Collection<IProcessingLogDocument>,
  message: SearchLogsMessage,
): Promise<SearchLogsResult> {
  const cursor = message.cursor === undefined ? undefined : decodeLogCursor(message.cursor);
  const filter = buildLogsFilter(message, cursor);

  const documents = await collection
    .find(filter)
    .sort({ timestamp: -1, _id: -1 })
    .limit(message.limit + 1)
    .toArray();

  const hasNextPage = documents.length > message.limit;
  const pageDocuments = hasNextPage ? documents.slice(0, message.limit) : documents;
  const data = pageDocuments.map(toLogEntry);
  const lastDocument = pageDocuments.at(-1);

  if (!hasNextPage || lastDocument === undefined) {
    return { data };
  }

  return {
    data,
    nextCursor: encodeLogCursor({
      timestamp: lastDocument.timestamp,
      id: lastDocument._id.toHexString(),
    }),
  };
}

function toLogEntry(document: WithId<IProcessingLogDocument>): IProcessingLogDocument {
  const entry: IProcessingLogDocument = {
    importId: document.importId,
    eventType: document.eventType,
    service: document.service,
    status: document.status,
    timestamp: document.timestamp,
    correlationId: document.correlationId,
    archive: document.archive,
    metadata: document.metadata,
  };

  if (document.errorInfo !== undefined) {
    entry.errorInfo = document.errorInfo;
  }

  return entry;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- search-logs.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-b/src/processing-log/search/search-logs.ts back-end/service-b/src/processing-log/search/search-logs.spec.ts
```

---

## Task 6: `service-b` — `LogsSearchService` (DI wrapper)

**Files:**
- Create: `back-end/service-b/src/processing-log/search/logs-search.service.ts`
- Create: `back-end/service-b/src/processing-log/search/logs-search.service.spec.ts`

**Interfaces:**
- Consumes: `PROCESSING_LOG_COLLECTION` (Phase 6, `../processing-log-collection.provider.js`), `searchLogs`
  / `type SearchLogsResult` (Task 5), `type SearchLogsMessage` (Task 3), `type IProcessingLogDocument`
  (Phase 6).
- Produces: `LogsSearchService.search(message: SearchLogsMessage): Promise<SearchLogsResult>` — thin
  injectable wrapper, mirrors service-a's `EventsSearchService` shape (constructor-injects the collection,
  one pass-through method).
- Consumed by: Task 7 (`LogsSearchController`, `ProcessingLogModule`).

- [ ] **Step 1: Write the failing test**

`back-end/service-b/src/processing-log/search/logs-search.service.spec.ts`:
```ts
import { type Collection } from 'mongodb';

import { type IProcessingLogDocument } from '../processing-log.types.js';

import { LogsSearchService } from './logs-search.service.js';

describe('LogsSearchService', () => {
  it('should delegate to searchLogs with the injected collection, when search is called', async () => {
    const cursor = {
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    };
    const collection = {
      find: vi.fn().mockReturnValue(cursor),
    } as unknown as Collection<IProcessingLogDocument>;
    const service = new LogsSearchService(collection);

    const result = await service.search({ limit: 50 });

    expect(result).toEqual({ data: [] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- logs-search.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `logs-search.service.ts`**

`back-end/service-b/src/processing-log/search/logs-search.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { type Collection } from 'mongodb';

import { PROCESSING_LOG_COLLECTION } from '../processing-log-collection.provider.js';
import { type IProcessingLogDocument } from '../processing-log.types.js';

import { searchLogs, type SearchLogsResult } from './search-logs.js';
import { type SearchLogsMessage } from './search-logs-message.schema.js';

@Injectable()
export class LogsSearchService {
  public constructor(
    @Inject(PROCESSING_LOG_COLLECTION)
    private readonly collection: Collection<IProcessingLogDocument>,
  ) {}

  public search(message: SearchLogsMessage): Promise<SearchLogsResult> {
    return searchLogs(this.collection, message);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- logs-search.service.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-b/src/processing-log/search/logs-search.service.ts back-end/service-b/src/processing-log/search/logs-search.service.spec.ts
```

---

## Task 7: `service-b` — `LogsSearchController` and `ProcessingLogModule` wiring

**Files:**
- Create: `back-end/service-b/src/processing-log/search/logs-search.controller.ts`
- Create: `back-end/service-b/src/processing-log/search/logs-search.controller.spec.ts`
- Modify: `back-end/service-b/src/processing-log/processing-log.module.ts`

**Interfaces:**
- Consumes: `LogsSearchService` (Task 6), `searchLogsMessageSchema` (Task 3), `type SearchLogsResult`
  (Task 5).
- Produces: `LogsSearchController` — `@MessagePattern('logs.search')`, request/reply. Because service-b
  runs `noAck: false` (Global Constraints Finding 1), it **acks the message in a `finally`** so the ack
  runs whether the search resolves or throws.
- Consumed by: gateway's `LogsController` (Task 11) via `ClientProxy.send('logs.search', ...)`.

- [ ] **Step 1: Write the failing tests**

`back-end/service-b/src/processing-log/search/logs-search.controller.spec.ts`:
```ts
import { type RmqContext } from '@nestjs/microservices';

import { LogsSearchController } from './logs-search.controller.js';
import { type LogsSearchService } from './logs-search.service.js';

describe('LogsSearchController', () => {
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

  it('should validate the payload, delegate to LogsSearchService, and ack, when a valid message is received', async () => {
    const searchResult = { data: [] };
    const search = vi.fn().mockResolvedValue(searchResult);
    const logsSearchService = { search } as unknown as LogsSearchService;
    const controller = new LogsSearchController(logsSearchService);
    const { context, message, ack } = buildContext();

    const result = await controller.handleSearch({ status: 'completed' }, context);

    expect(result).toBe(searchResult);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', limit: 50 }));
    expect(ack).toHaveBeenCalledWith(message);
  });

  it('should reject but still ack, when the payload fails schema validation', async () => {
    const search = vi.fn();
    const logsSearchService = { search } as unknown as LogsSearchService;
    const controller = new LogsSearchController(logsSearchService);
    const { context, message, ack } = buildContext();

    await expect(controller.handleSearch({ limit: -1 }, context)).rejects.toThrow();
    expect(search).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith(message);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- logs-search.controller.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `logs-search.controller.ts`**

`back-end/service-b/src/processing-log/search/logs-search.controller.ts`:
```ts
import { Controller } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, type RmqContext } from '@nestjs/microservices';

import { LogsSearchService } from './logs-search.service.js';
import { searchLogsMessageSchema } from './search-logs-message.schema.js';
import { type SearchLogsResult } from './search-logs.js';

@Controller()
export class LogsSearchController {
  public constructor(private readonly logsSearchService: LogsSearchService) {}

  @MessagePattern('logs.search')
  public async handleSearch(
    @Payload() payload: unknown,
    @Ctx() context: RmqContext,
  ): Promise<SearchLogsResult> {
    try {
      const message = searchLogsMessageSchema.parse(payload);

      return await this.logsSearchService.search(message);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- RmqContext channel is loosely typed; matches HealthController's manual-ack precedent under noAck: false
      context.getChannelRef().ack(context.getMessage());
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- logs-search.controller.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire `LogsSearchService`/`LogsSearchController` into `ProcessingLogModule`**

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

@Module({
  imports: [LoggerModule],
  controllers: [ImportEventsController, LogsSearchController],
  providers: [
    processingLogCollectionProvider,
    EnsureProcessingLogIndexesInitializer,
    ProcessingLogTracker,
    LogsSearchService,
  ],
})
export class ProcessingLogModule {}
```

- [ ] **Step 6: Run the full `service-b` test suite**

Run: `pnpm --filter service-b test`
Expected: PASS — every existing suite plus this phase's new specs.

- [ ] **Step 7: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 8: Stage the files**

```bash
git add back-end/service-b/src/processing-log/search/logs-search.controller.ts back-end/service-b/src/processing-log/search/logs-search.controller.spec.ts back-end/service-b/src/processing-log/processing-log.module.ts
```

---

## Task 8: `api-gateway` — `SearchLogsQueryDto`

**Files:**
- Create: `back-end/api-gateway/src/logs/dto/search-logs-query.dto.ts`
- Create: `back-end/api-gateway/src/logs/dto/search-logs-query.dto.spec.ts`

**Interfaces:**
- Produces: `SearchLogsQueryDto { importId?: string; status?: 'started' | 'completed' | 'failed'; from?:
  string; to?: string; cursor?: string; limit: number }` (`limit` defaults to 50 via a class field
  initializer, capped at 200) — validated by the gateway's existing global `ValidationPipe` (`whitelist:
  true, transform: true, forbidNonWhitelisted: true`).
- Consumed by: Task 11 (`LogsController`).

- [ ] **Step 1: Write the failing tests**

`back-end/api-gateway/src/logs/dto/search-logs-query.dto.spec.ts`:
```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SearchLogsQueryDto } from './search-logs-query.dto.js';

describe('SearchLogsQueryDto', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  it('should default limit to 50 and produce no validation errors, when no query params are provided', async () => {
    const dto = plainToInstance(SearchLogsQueryDto, {});

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(50);
  });

  it('should produce no validation errors, when every field is well-formed', async () => {
    const dto = plainToInstance(SearchLogsQueryDto, {
      importId,
      status: 'completed',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-11T00:00:00.000Z',
      cursor: 'some-cursor',
      limit: '25',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(25);
  });

  it('should produce a validation error, when limit exceeds 200', async () => {
    const dto = plainToInstance(SearchLogsQueryDto, { limit: '201' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
  });

  it('should produce a validation error, when limit is zero', async () => {
    const dto = plainToInstance(SearchLogsQueryDto, { limit: '0' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
  });

  it('should produce a validation error, when importId is not a uuid', async () => {
    const dto = plainToInstance(SearchLogsQueryDto, { importId: 'not-a-uuid' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
  });

  it('should produce a validation error, when status is not a known processing status', async () => {
    const dto = plainToInstance(SearchLogsQueryDto, { status: 'unknown' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
  });

  it('should produce a validation error, when from is not a valid ISO-8601 string', async () => {
    const dto = plainToInstance(SearchLogsQueryDto, { from: 'not-a-date' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter api-gateway test -- search-logs-query.dto.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `search-logs-query.dto.ts`**

`back-end/api-gateway/src/logs/dto/search-logs-query.dto.ts`:
```ts
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const LOG_STATUSES = ['started', 'completed', 'failed'] as const;

export class SearchLogsQueryDto {
  @IsOptional()
  @IsUUID()
  public readonly importId?: string;

  @IsOptional()
  @IsIn(LOG_STATUSES)
  public readonly status?: (typeof LOG_STATUSES)[number];

  @IsOptional()
  @IsISO8601()
  public readonly from?: string;

  @IsOptional()
  @IsISO8601()
  public readonly to?: string;

  @IsOptional()
  @IsString()
  public readonly cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  public readonly limit: number = DEFAULT_LIMIT;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter api-gateway test -- search-logs-query.dto.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter api-gateway lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/api-gateway/src/logs/dto/search-logs-query.dto.ts back-end/api-gateway/src/logs/dto/search-logs-query.dto.spec.ts
```

---

## Task 9: `api-gateway` — response DTOs

**Files:**
- Create: `back-end/api-gateway/src/logs/dto/log-response.dto.ts`
- Create: `back-end/api-gateway/src/logs/dto/search-logs-response.dto.ts`

**Interfaces:**
- Produces: `ILogEntryView` (the gateway's own view of a processing-log entry as it arrives over RMQ —
  `timestamp` is a `string`, not a `Date`, because the RMQ transport JSON-serializes the reply and
  `JSON.parse` never revives `Date`s; see Phase 4's Finding 2), `LogResponseDto` (constructor: `(document:
  ILogEntryView)`), `SearchLogsResponseDto` (constructor: `(data: LogResponseDto[], nextCursor?: string)`).
- Consumed by: Task 11 (`LogsController`).

This task has no dedicated unit test — both are plain data-mapping classes with only a single `errorInfo`
branch, matching `EventResponseDto`'s precedent; their shape is exercised by Task 12's integration test.

- [ ] **Step 1: Implement `log-response.dto.ts`**

`back-end/api-gateway/src/logs/dto/log-response.dto.ts`:
```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export interface ILogEntryView {
  importId: string;
  eventType: string;
  service: string;
  status: string;
  timestamp: string;
  correlationId: string;
  archive: string;
  metadata: Record<string, number>;
  errorInfo?: { reason: string };
}

export class LogResponseDto {
  @ApiProperty({ example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  public readonly importId: string;

  @ApiProperty({ example: 'github.import.completed' })
  public readonly eventType: string;

  @ApiProperty({ example: 'service-a' })
  public readonly service: string;

  @ApiProperty({ example: 'completed' })
  public readonly status: string;

  @ApiProperty({ example: '2026-08-11T00:05:00.000Z' })
  public readonly timestamp: string;

  @ApiProperty({ example: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  public readonly correlationId: string;

  @ApiProperty({ example: '2026-08-11-0.json.gz' })
  public readonly archive: string;

  @ApiProperty({ type: Object, example: { eventsProcessed: 10, validEvents: 8 } })
  public readonly metadata: Record<string, number>;

  @ApiPropertyOptional({ example: { reason: 'download failed: 404 Not Found' } })
  public readonly errorInfo?: { reason: string };

  public constructor(document: ILogEntryView) {
    this.importId = document.importId;
    this.eventType = document.eventType;
    this.service = document.service;
    this.status = document.status;
    this.timestamp = document.timestamp;
    this.correlationId = document.correlationId;
    this.archive = document.archive;
    this.metadata = document.metadata;

    if (document.errorInfo !== undefined) {
      this.errorInfo = document.errorInfo;
    }
  }
}
```

- [ ] **Step 2: Implement `search-logs-response.dto.ts`**

`back-end/api-gateway/src/logs/dto/search-logs-response.dto.ts`:
```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { LogResponseDto } from './log-response.dto.js';

export class SearchLogsResponseDto {
  @ApiProperty({ type: [LogResponseDto] })
  public readonly data: LogResponseDto[];

  @ApiPropertyOptional({
    description: 'Opaque cursor for the next page; absent when no more results exist',
    example: 'eyJ0aW1lc3RhbXAiOiIyMDI2LTA4LTExVDAwOjAwOjAwLjAwMFoiLCJpZCI6IjY0YjdmMGMyZjFhMmIzYzRkNWU2ZjdhMSJ9',
  })
  public readonly nextCursor?: string;

  public constructor(data: LogResponseDto[], nextCursor?: string) {
    this.data = data;

    if (nextCursor !== undefined) {
      this.nextCursor = nextCursor;
    }
  }
}
```

- [ ] **Step 3: Lint**

Run: `pnpm --filter api-gateway lint`
Expected: PASS.

- [ ] **Step 4: Stage the files**

```bash
git add back-end/api-gateway/src/logs/dto/log-response.dto.ts back-end/api-gateway/src/logs/dto/search-logs-response.dto.ts
```

---

## Task 10: `api-gateway` — `SERVICE_B_RMQ_CLIENT` token and `LogsModule`

**Files:**
- Create: `back-end/api-gateway/src/logs/rabbitmq-client.token.ts`
- Create: `back-end/api-gateway/src/logs/logs.module.ts`

**Interfaces:**
- Consumes: `rabbitmqConfig` (existing).
- Produces: `SERVICE_B_RMQ_CLIENT` (string DI token, module-scoped to `LogsModule`), `LogsModule`
  (registers the RMQ client pointed at `rabbitmqConfig().serviceBQueue`, declares `LogsController`).
- Consumed by: Task 11 (`LogsController`), Task 12 (integration test), Task 13 (`app.module.ts`).

This task has no dedicated unit test — `ClientsModule.registerAsync` is framework wiring, exercised
end-to-end by Task 12's integration test (matching `EventsModule`'s precedent).

- [ ] **Step 1: Create the token file**

`back-end/api-gateway/src/logs/rabbitmq-client.token.ts`:
```ts
export const SERVICE_B_RMQ_CLIENT = 'SERVICE_B_RMQ_CLIENT';
```

- [ ] **Step 2: Implement `logs.module.ts`**

`back-end/api-gateway/src/logs/logs.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';

import rabbitmqConfig from '../config/rabbitmq.config.js';

import { LogsController } from './logs.controller.js';
import { SERVICE_B_RMQ_CLIENT } from './rabbitmq-client.token.js';

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
  controllers: [LogsController],
})
export class LogsModule {}
```

- [ ] **Step 3: Lint** (will fail until Task 11 creates `logs.controller.ts` — proceed to Task 11 first if
  executing strictly in order; both are commonly implemented and linted together)

Run: `pnpm --filter api-gateway lint`
Expected: PASS after Task 11.

- [ ] **Step 4: Stage the files**

```bash
git add back-end/api-gateway/src/logs/rabbitmq-client.token.ts back-end/api-gateway/src/logs/logs.module.ts
```

---

## Task 11: `api-gateway` — `LogsController`

**Files:**
- Create: `back-end/api-gateway/src/logs/logs.controller.ts`

**Interfaces:**
- Consumes: `SERVICE_B_RMQ_CLIENT` (Task 10), `SearchLogsQueryDto` (Task 8), `LogResponseDto`/`type
  ILogEntryView`/`SearchLogsResponseDto` (Task 9), `rabbitmqConfig` (existing),
  `buildOutboundHeaders`/`RequestContextService` (`@task1/shared/request-context`, existing — same as
  `EventsController`'s precedent).
- Produces: `LogsController` — `GET /logs` (full runtime path `/api/v1/logs` once `main.ts`'s global
  prefix/versioning apply).
- Consumed by: Task 10 (`LogsModule.controllers`), Task 12 (integration test).

This is a business-RPC (`send()`, request/reply) call site with an HTTP listener and a live RMQ client
dependency — per the testing skill it gets an `.int.spec.ts` (Task 12), not a `.spec.ts`.

- [ ] **Step 1: Implement `logs.controller.ts`**

`back-end/api-gateway/src/logs/logs.controller.ts`:
```ts
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { buildOutboundHeaders } from '@task1/shared/request-context/propagation.util';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { firstValueFrom, timeout } from 'rxjs';

import rabbitmqConfig from '../config/rabbitmq.config.js';

import { type ILogEntryView, LogResponseDto } from './dto/log-response.dto.js';
import { SearchLogsQueryDto } from './dto/search-logs-query.dto.js';
import { SearchLogsResponseDto } from './dto/search-logs-response.dto.js';
import { SERVICE_B_RMQ_CLIENT } from './rabbitmq-client.token.js';

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- deliberately a `type`, matching the RMQ reply shape of `SearchLogsResult`
type SearchLogsRpcResult = { data: ILogEntryView[]; nextCursor?: string };

const LOGS_SEARCH_PATTERN = 'logs.search';

@ApiTags('logs')
@Controller('logs')
export class LogsController {
  public constructor(
    @Inject(SERVICE_B_RMQ_CLIENT) private readonly serviceBClient: ClientProxy,
    private readonly requestContextService: RequestContextService,
    @Inject(rabbitmqConfig.KEY)
    private readonly rabbitmqConfiguration: ConfigType<typeof rabbitmqConfig>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Query processing logs with filters and cursor pagination' })
  @ApiQuery({ name: 'importId', required: false, description: 'Import run UUID' })
  @ApiQuery({ name: 'status', required: false, description: 'started | completed | failed' })
  @ApiQuery({ name: 'from', required: false, description: 'ISO-8601 lower bound for timestamp' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO-8601 upper bound for timestamp' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Opaque pagination cursor from a previous response',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Max results per page (default 50, max 200)',
  })
  @ApiOkResponse({ type: SearchLogsResponseDto })
  public async search(@Query() query: SearchLogsQueryDto): Promise<SearchLogsResponseDto> {
    const headers = buildOutboundHeaders(this.requestContextService.requireContext());
    const record = new RmqRecordBuilder(query).setOptions({ headers }).build();

    const result = await firstValueFrom(
      this.serviceBClient
        .send<SearchLogsRpcResult>(LOGS_SEARCH_PATTERN, record)
        .pipe(timeout(this.rabbitmqConfiguration.rpcTimeoutMs)),
    );

    const data = result.data.map((entry) => new LogResponseDto(entry));

    return new SearchLogsResponseDto(data, result.nextCursor);
  }
}
```

- [ ] **Step 2: Lint both Task 10 and Task 11 files together**

Run: `pnpm --filter api-gateway lint`
Expected: PASS.

- [ ] **Step 3: Stage the file**

```bash
git add back-end/api-gateway/src/logs/logs.controller.ts
```

---

## Task 12: `api-gateway` — `LogsController` integration test

**Files:**
- Create: `back-end/api-gateway/src/logs/logs.controller.int.spec.ts`

**Interfaces:**
- Consumes: `LogsModule` (Task 10), `SERVICE_B_RMQ_CLIENT` (Task 10), `AuthGuard`/`AuthModule` (existing),
  `rabbitmqConfig` (existing).

- [ ] **Step 1: Write the failing integration tests**

`back-end/api-gateway/src/logs/logs.controller.int.spec.ts`:
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

import { LogsModule } from './logs.module.js';
import { SERVICE_B_RMQ_CLIENT } from './rabbitmq-client.token.js';

type App = Parameters<typeof request>[0];

describe('LogsController (HTTP Integration)', () => {
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
        LogsModule,
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

  describe('GET /logs', () => {
    const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const correlationId = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

    it('should return 200 with the mapped logs and nextCursor, when service-b replies successfully', async () => {
      serviceBClient.send.mockReturnValue(
        of({
          data: [
            {
              importId,
              eventType: 'github.import.completed',
              service: 'service-a',
              status: 'completed',
              timestamp: '2026-08-11T00:05:00.000Z',
              correlationId,
              archive: '2026-08-11-0.json.gz',
              metadata: { eventsProcessed: 10 },
            },
          ],
          nextCursor: 'some-cursor',
        }),
      );

      const response = await request(httpServer).get('/logs').query({ status: 'completed' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        data: [
          {
            importId,
            eventType: 'github.import.completed',
            service: 'service-a',
            status: 'completed',
            timestamp: '2026-08-11T00:05:00.000Z',
            correlationId,
            archive: '2026-08-11-0.json.gz',
            metadata: { eventsProcessed: 10 },
          },
        ],
        nextCursor: 'some-cursor',
      });
    });

    it('should forward the query filters and default limit inside the RMQ message, when a search is performed', async () => {
      serviceBClient.send.mockReturnValue(of({ data: [] }));

      await request(httpServer).get('/logs').query({ status: 'completed' });

      const [pattern, record] = serviceBClient.send.mock.calls[0] as [
        string,
        { data: { status: string; limit: number } },
      ];
      expect(pattern).toBe('logs.search');
      expect(record.data).toEqual(expect.objectContaining({ status: 'completed', limit: 50 }));
    });

    it('should send a message record whose headers include a correlation id, when a search is performed', async () => {
      serviceBClient.send.mockReturnValue(of({ data: [] }));

      await request(httpServer).get('/logs');

      const [, record] = serviceBClient.send.mock.calls[0] as [
        string,
        { options: { headers: Record<string, string> } },
      ];
      expect(typeof record.options.headers['x-correlation-id']).toBe('string');
    });

    it('should return 400 and not call service-b, when limit exceeds 200', async () => {
      const response = await request(httpServer).get('/logs').query({ limit: '201' });

      expect(response.status).toBe(400);
      expect(serviceBClient.send).not.toHaveBeenCalled();
    });

    it('should return 400 and not call service-b, when status is not a known processing status', async () => {
      const response = await request(httpServer).get('/logs').query({ status: 'unknown' });

      expect(response.status).toBe(400);
      expect(serviceBClient.send).not.toHaveBeenCalled();
    });

    it('should return 400 and not call service-b, when an unknown query parameter is provided', async () => {
      const response = await request(httpServer).get('/logs').query({ unknown: 'value' });

      expect(response.status).toBe(400);
      expect(serviceBClient.send).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail (if run before Tasks 10/11 exist)**

Run: `pnpm --filter api-gateway test -- logs.controller.int.spec.ts`
Expected: FAIL (module not found) until Tasks 10/11 exist.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm --filter api-gateway test -- logs.controller.int.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 4: Lint**

Run: `pnpm --filter api-gateway lint`
Expected: PASS.

- [ ] **Step 5: Stage the file**

```bash
git add back-end/api-gateway/src/logs/logs.controller.int.spec.ts
```

---

## Task 13: `api-gateway` — wire `LogsModule` into `app.module.ts`

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
import { LogsModule } from './logs/logs.module.js';

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
    LogsModule,
  ],
})
export class AppModule {}
```

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

## Task 14: End-to-end verification

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

- [ ] **Step 5: Confirm the new indexes exist on `processing-logs`**

Run: `docker compose exec mongodb mongosh service_b --quiet --eval "db.getCollection('processing-logs').getIndexes().length"`
Expected: `5` (the default `_id` index Mongo always creates, plus the four this phase's
`ensureProcessingLogIndexes` creates).

- [ ] **Step 6: Confirm the logs endpoint is reachable**

Run:
```bash
curl -s "http://localhost:3000/api/v1/logs?limit=5"
```
Expected: a JSON body shaped `{"data": [...], "nextCursor": "..."}` (or `{"data": []}` if no import has
run yet) — **not** a 403 (the gateway's `AuthGuard` currently denies all non-`@Public()` routes
unconditionally; a 403 here is the current, expected, documented behavior of the fail-closed auth stub,
not a bug in this phase).

- [ ] **Step 7: Tear down**

Run: `pnpm docker:down`
Expected: all containers stop cleanly.

---

## Self-Review

**Spec coverage:** the design doc's "Service-b: log query API (Phase 7)" section maps entirely to Tasks
1–13: `GET /v1/logs?importId=...&status=...&from=...&to=...&cursor=...` (Tasks 8, 11), "same
cursor-pagination shape as the search API" via `{timestamp, _id}` keyset (Tasks 2, 4, 5), "same 'filter
and sort entirely in MongoDB' rule" — never more than one page loaded into Node (Task 5), and "same
indexes pattern (`{importId:1, timestamp:-1}`, `{status:1, timestamp:-1}`, default `{timestamp:-1,
_id:-1}`)" (Task 1). The design doc's `limit` cap of 200 (mirrored from the search API) is enforced at
both boundaries (Tasks 3, 8).

**Placeholder scan:** no TBD/TODO; every step shows complete file contents or an exact runnable command
with expected output.

**Type/name consistency:** `SearchLogsMessage` (Task 3) is consumed unchanged by `build-logs-filter.ts`
(Task 4), `search-logs.ts` (Task 5), and `logs-search.controller.ts` (Task 7). `SearchLogsResult` (Task
5) is consumed unchanged by `LogsSearchService` (Task 6) and is the shape `LogsSearchController.handleSearch`
(Task 7) returns. `ILogCursor` (Task 2) is consumed unchanged by `build-logs-filter.ts` and
`search-logs.ts`. On the gateway side, `SearchLogsQueryDto` (Task 8) field names (`importId`, `status`,
`from`, `to`, `cursor`, `limit`) match `SearchLogsMessage`'s exactly, so service-b's Zod schema validates
exactly what the gateway sends, with no field-name translation layer. `ILogEntryView` (Task 9) is the one
shared contract between the gateway's `LogResponseDto` constructor and its `LogsController` RPC reply type
(Task 11), and its `timestamp: string` matches the RMQ-serialized reply (Phase 4's Finding 2). The RPC
pattern string `'logs.search'` is identical in `LogsSearchController` (Task 7) and `LogsController` (Task
11).

**Cross-service boundary:** `IProcessingLogDocument` stays service-b-internal (never imported by the
gateway); the gateway declares `ILogEntryView` independently — consistent with Phase 6's decision and
`CLAUDE.md`'s module-boundary rule.
