# Phase 4: Service-a Search API & Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /v1/events` (gateway) — filters imported GitHub events by `type`/`repository`/
`actor`/`from`/`to` and paginates via an opaque keyset cursor, forwarding the request as a small
DTO over the existing RMQ RPC pattern (`ClientProxy.send`) to `service-a`, which builds a
MongoDB filter and queries with `{createdAt, eventId}` keyset pagination — never `skip()`, never
loading more than one page's worth of documents into Node.

**Architecture:** A new `back-end/service-a/src/archive/search/` subfolder (matching the
existing `archive/download/`, `archive/processing/`, `archive/upload/` per-concern layout) holds
the pure step functions — `event-cursor.util.ts` (opaque cursor encode/decode), `build-events-
filter.ts` (pure Mongo filter builder), `search-events-message.schema.ts` (Zod validation for the
inbound RMQ payload) — plus `search-events.ts`, the orchestration function, wired into NestJS via
`EventsSearchService` (injects the existing `EVENTS_COLLECTION` token) and a new
`EventsSearchController` (`@MessagePattern('events.search')`), added to the existing
`ArchiveModule`. On the gateway side, a new `back-end/api-gateway/src/events/` module owns
`GET /events`: a class-validator `SearchEventsQueryDto` (this repo's global `ValidationPipe` is
class-validator-based, confirmed against `main.ts`), a module-scoped `SERVICE_A_RMQ_CLIENT`
(duplicating `ImportsModule`'s own registration — see Global Constraints), and an
`EventsController` that calls `ClientProxy.send()` with an `RmqRecordBuilder`-wrapped payload
carrying propagated correlation headers, exactly like the existing
`RabbitMqPingHealthIndicator` — the only precedent for `send()` (request/reply RPC) in this
codebase; `ImportsModule`'s upload flow uses `emit()` (fire-and-forget) instead, which is not the
right pattern here since the gateway needs the actual search results back.

**Tech Stack:** `@nestjs/microservices` (`ClientProxy.send`, `@MessagePattern`), Zod (service-a
inbound message validation, matching `uploadImportMessageSchema`'s precedent), `class-validator`/
`class-transformer` (gateway query DTO — already dependencies, first real use of them in this
codebase beyond the global `ValidationPipe` registration), official `mongodb` driver v7
(`Collection.find().sort().limit().toArray()`, dotted-path filter keys), Vitest.

**Design doc:** `docs/superpowers/specs/2026-08-12-github-archive-platform-design.md` (section
"Service-a: search API & pagination (Phase 4)", plus the `events` collection indexes in "Data
model (service-a, MongoDB)").
**Roadmap:** `docs/superpowers/plans/2026-08-12-github-archive-platform-plan.md` (Phase 4 of 11).
**Depends on:** Phase 0 (`IGithubEventDocument`, `EVENTS_COLLECTION`/`MONGO_CLIENT`), Phase 2
(`ensureEventIndexes`, already called at startup by `EnsureEventIndexesInitializer` —
this phase only adds more indexes to that same function, no new startup wiring needed), Phase 3
(`ArchiveModule`, `ImportsModule`'s `rabbitmq-client.token.ts`/`ClientsModule.registerAsync`
pattern this phase's `EventsModule` duplicates).

Every file path, existing convention, and framework detail below was verified by reading this
exact repository's current state (post-Phase-3) — not guessed from the design doc's original
Phase 3 plan, which described a slightly different file layout than what actually shipped (e.g.
service-a's upload handler lives at `archive/upload/upload-import.controller.ts`, not
`archive/import.controller.ts`). Three non-obvious findings are called out below.

## Global Constraints

- Never throw raw `Error` — `InvalidCursorError` (new,
  `back-end/service-a/src/archive/search/errors.ts`) extends `ValidationError`, matching
  `MissingUploadFileError`'s pattern exactly (a caller-input problem, not an external-dependency
  failure).
- **Finding 1 — MongoDB's `Filter<TSchema>` type permits arbitrary dotted-path string keys.**
  Verified against the installed driver's own type declarations
  (`node_modules/mongodb/mongodb.d.ts`): `Filter<TSchema> = {[P in keyof WithId<TSchema>]?:
  Condition<...>} & RootFilterOperators<WithId<TSchema>>`, and `RootFilterOperators<TSchema>
  extends Document` where `Document` (from `bson`) carries a `[key: string]: any` index
  signature — inherited through the `extends` chain onto the intersection type. This means
  `filter['repo.name'] = 'octocat/hello-world'` type-checks against `Filter<IGithubEventDocument>`
  with no cast needed, even though `'repo.name'` isn't a literal key of `IGithubEventDocument`.
  `security/detect-object-injection` does not fire here either — that rule targets
  variable-derived bracket keys (`obj[someVariable]`), not object-literal string keys like
  `'repo.name'`.
- **Finding 2 — a Date crossing the RMQ RPC boundary arrives at the gateway as an ISO string,
  not a `Date` instance.** `@nestjs/microservices`'s RMQ transport JSON-serializes the reply
  payload; `JSON.parse` never revives strings back into `Date` objects. So while
  `IGithubEventDocument.createdAt` is typed `Date` on the `service-a` side (the real Mongo
  document shape), the gateway's `EventsController` receives `createdAt` as a plain `string`.
  `EventResponseDto`'s constructor is typed to accept `Omit<IGithubEventDocument, 'createdAt'> &
  { createdAt: string }` and assigns `createdAt` directly — it does **not** call
  `.toISOString()` (that would throw, since the received value is already a string, not a
  `Date`).
- **Finding 3 — `EventsSearchController.handleSearch` must be declared `async` and use `return
  await`, not the bare-passthrough shape `ArchiveProcessingService.process` uses.** The bare
  `return somePromise;` (no `async`) passthrough shape is only safe when nothing before the
  `return` can throw synchronously. Here, `searchEventsMessageSchema.parse(payload)` runs first
  and throws synchronously on a validation failure; wrapping the method in `async` converts that
  synchronous throw into a rejected promise (required for `@MessagePattern` handlers and for
  `.rejects.toThrow()` to work in a plain unit test that calls the method directly, not through
  Nest's pipeline). This matches `UploadImportController.handleUpload`'s existing shape exactly
  (also `async`, also parses-then-awaits), not `ArchiveProcessingService.process`'s.
  `@typescript-eslint/return-await: ['error', 'always']` then requires `return await
  this.eventsSearchService.search(message);`, not a bare `return`.
- This phase adds the three query-pattern indexes and the default pagination index that Phase 2
  deliberately deferred (`ensure-event-indexes.ts`'s existing Global Constraints note: "nothing
  in this phase queries the collection... they belong to Phase 4"). All five indexes
  (`{eventId:1}` unique, already present, plus the four new ones) live in the same
  `ensureEventIndexes` function — `EnsureEventIndexesInitializer` (Phase 3) already calls it at
  `OnModuleInit`, so no new startup wiring is needed, only the function body growing.
- The cursor is an **opaque, server-only-decodable string** (base64url of
  `{createdAt: ISO string, eventId}`) — the client (frontend, Swagger caller) must never
  construct or inspect one, only pass back whatever `nextCursor` it was given. This matches the
  design doc's "Response includes `data` and `nextCursor`... the client passes `nextCursor` back
  as the next request's `cursor`" — no meaning is assigned to its contents from the outside.
  `event-cursor.util.ts` intentionally lives inside `service-a`'s own `archive/search/` folder,
  not `@task1/shared` — Phase 7's `service-b` log-search cursor will be its own, separate
  implementation (matching this repo's established no-cross-service-imports module boundary; see
  Phase 0's `MongoConnectionService`/`RedisConnectionService`, deliberately duplicated per
  service rather than shared).
- `EventsModule` (gateway) registers its **own** `SERVICE_A_RMQ_CLIENT` via
  `ClientsModule.registerAsync`, under its own `rabbitmq-client.token.ts` — the third such
  duplicate registration in this codebase (`HealthModule`, `ImportsModule`, now `EventsModule`),
  all pointed at the same `rabbitmqConfig().serviceAQueue`. Phase 3's Global Constraints already
  flagged this exact trigger point ("a reasonable future cleanup once a third consumer appears
  \[...\] not something this phase should speculatively build") — consolidating three
  already-shipped modules into one shared `ClientsModule` registration is a cross-cutting
  refactor of existing, working code, out of scope for a phase whose job is to add a new
  endpoint (`CLAUDE.md`'s Quality checklist: "no unrelated refactoring"). Three independent AMQP
  connections to the same queue remains an acceptable, documented trade-off at this project's
  scale.
- Zod validates the inbound RMQ message shape (`search-events-message.schema.ts`, matching
  `uploadImportMessageSchema`'s precedent); `class-validator`/`class-transformer` validate the
  gateway's HTTP query params (`SearchEventsQueryDto`) — each service keeps using the validation
  library already established at its own boundary, matching `CLAUDE.md`'s "Validate before
  executing business logic" without introducing a second validation library into either service.
- `unicorn/prevent-abbreviations` rejects short names — full words throughout (see Phase 1's
  Global Constraints for the exact rule and its `Dto`/`dto`/`req`/`res`/`E2e`/`e2e` exceptions).
- Type-only imports use inline `type` modifiers; relative imports use explicit `.js` extensions;
  imports grouped (builtin/external/internal/parent/sibling/index), alphabetized ascending
  case-insensitive, blank line between groups — matches every prior phase.
- Naming: `interface`s are `PascalCase` prefixed with `I` (e.g. `IEventCursor` — a
  newly-introduced data shape with no prior binding name). `type` aliases are `PascalCase` with
  **no** prefix — this includes `SearchEventsMessage` (a `z.infer<...>` result) and
  `SearchEventsResult` (matching `ImportResult`'s precedent: the roadmap's own Self-Review commits
  to `SearchEventsResult { data: GithubEventDto[], nextCursor?: string }` as a bare, unprefixed
  name reused unchanged wherever this result shape travels).
- Blank line required before every `return`/`throw` following a `const`/`let`/`var` or expression
  statement, and before every `if`.
- No `git commit` restriction in this plan's execution worktree — per this repo's established
  convention, commits inside an isolated implementation worktree are expected; per `CLAUDE.md`,
  only the user commits work outside such a worktree.
- BDD test naming: `it('should X, when Y')`. Coverage thresholds: 90% lines, 90% branches.
- Mocking convention: plain object literal matching only the members under test, cast with `as
  unknown as <RealType>` — never `vi.mock()` (matches every prior phase).
- No dedicated `*.spec.ts` for `archive/search/errors.ts` — matches every prior phase's
  convention for `errors.ts` files; `InvalidCursorError`'s throw-behavior is exercised indirectly
  by `event-cursor.util.spec.ts`'s failure-path tests.
- Every gateway `.int.spec.ts` mirrors the established shape (`upload-import.controller.int.spec.ts`):
  imports `RequestContextModule` (http) and `ExceptionHandlingModule` (http) because the
  controller path can throw/receive serialized errors that need real formatting; overrides
  `AuthGuard` with `{ canActivate: () => true }` (this codebase's `AuthGuard` currently denies
  every non-`@Public()` route unconditionally — a deliberate fail-closed stub per `CLAUDE.md`'s
  security section, pending a real auth provider — every existing non-health integration test
  already overrides it the same way). Unlike `health.controller.int.spec.ts` and
  `upload-import.controller.int.spec.ts`, this phase's int spec **also** calls
  `app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true,
  forbidNonWhitelisted: true }))` after `createNestApplication()` — `main.ts`'s global pipe
  registration only applies to the real bootstrapped app, not to `Test.createTestingModule()`
  fixtures, and this is the first phase whose HTTP-visible behavior (400 on bad/unknown query
  params) depends on that pipe actually running.

---

## Task 1: `service-a` — extend `ensureEventIndexes` with the search/pagination indexes

**Files:**
- Modify: `back-end/service-a/src/archive/processing/ensure-event-indexes.ts`
- Modify: `back-end/service-a/src/archive/processing/ensure-event-indexes.spec.ts`

**Interfaces:**
- Produces: `ensureEventIndexes(collection: Collection<IGithubEventDocument>): Promise<void>` —
  unchanged signature, now creates five indexes total: the existing `{eventId:1}` unique index,
  plus `{createdAt:-1, eventId:-1}` (default pagination), `{eventType:1, createdAt:-1}`,
  `{'repo.name':1, createdAt:-1}`, `{'actor.login':1, createdAt:-1}` (one per common
  single-filter access pattern, per the design doc's "Data model" section).
- Consumed by: `EnsureEventIndexesInitializer` (Phase 3, already calls this function at
  `OnModuleInit` — no change needed there), Task 5 below (`searchEvents`'s query relies on these
  indexes existing for correct/performant sort behavior, though the unit tests mock the
  collection so this is a runtime-only dependency, not a compile-time one).

- [ ] **Step 1: Write the failing tests for the four new indexes**

Replace the full contents of
`back-end/service-a/src/archive/processing/ensure-event-indexes.spec.ts`:
```ts
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection } from 'mongodb';

import { ensureEventIndexes } from './ensure-event-indexes.js';

describe('ensureEventIndexes', () => {
  it('should create the unique eventId index, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('eventId_1');
    const collection = { createIndex } as unknown as Collection<IGithubEventDocument>;

    await ensureEventIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ eventId: 1 }, { unique: true });
  });

  it('should create the default pagination index, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('createdAt_-1_eventId_-1');
    const collection = { createIndex } as unknown as Collection<IGithubEventDocument>;

    await ensureEventIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ createdAt: -1, eventId: -1 });
  });

  it('should create the eventType filter index, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('eventType_1_createdAt_-1');
    const collection = { createIndex } as unknown as Collection<IGithubEventDocument>;

    await ensureEventIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ eventType: 1, createdAt: -1 });
  });

  it('should create the repo.name filter index, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('repo.name_1_createdAt_-1');
    const collection = { createIndex } as unknown as Collection<IGithubEventDocument>;

    await ensureEventIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ 'repo.name': 1, createdAt: -1 });
  });

  it('should create the actor.login filter index, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('actor.login_1_createdAt_-1');
    const collection = { createIndex } as unknown as Collection<IGithubEventDocument>;

    await ensureEventIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ 'actor.login': 1, createdAt: -1 });
  });

  it('should create exactly five indexes, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('index');
    const collection = { createIndex } as unknown as Collection<IGithubEventDocument>;

    await ensureEventIndexes(collection);

    expect(createIndex).toHaveBeenCalledTimes(5);
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `pnpm --filter service-a test -- ensure-event-indexes.spec.ts`
Expected: FAIL — the four new index assertions fail (only the unique-index `createIndex` call
exists so far); the "exactly five indexes" assertion also fails (currently 1).

- [ ] **Step 3: Implement the four additional indexes**

Replace the full contents of `back-end/service-a/src/archive/processing/ensure-event-indexes.ts`:
```ts
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection } from 'mongodb';

export async function ensureEventIndexes(
  collection: Collection<IGithubEventDocument>,
): Promise<void> {
  await collection.createIndex({ eventId: 1 }, { unique: true });
  await collection.createIndex({ createdAt: -1, eventId: -1 });
  await collection.createIndex({ eventType: 1, createdAt: -1 });
  await collection.createIndex({ 'repo.name': 1, createdAt: -1 });
  await collection.createIndex({ 'actor.login': 1, createdAt: -1 });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter service-a test -- ensure-event-indexes.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the existing initializer spec to confirm no regression**

Run: `pnpm --filter service-a test -- ensure-event-indexes-initializer.service.spec.ts`
Expected: PASS (2 tests, unchanged — that spec only asserts `createIndex` was called *with* the
`{eventId:1}` args among however many calls happen, so it stays green).

- [ ] **Step 6: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 7: Stage the files**

```bash
git add back-end/service-a/src/archive/processing/ensure-event-indexes.ts back-end/service-a/src/archive/processing/ensure-event-indexes.spec.ts
```

---

## Task 2: `service-a` — event cursor codec and its error type

**Files:**
- Create: `back-end/service-a/src/archive/search/errors.ts`
- Create: `back-end/service-a/src/archive/search/event-cursor.util.ts`
- Create: `back-end/service-a/src/archive/search/event-cursor.util.spec.ts`

**Interfaces:**
- Produces: `InvalidCursorError extends ValidationError` (constructor: `(cursor: string, cause?:
  Error)`, code `'INVALID_CURSOR'`, category `VALIDATION`, `params: { cursor }`).
- Produces: `IEventCursor { createdAt: Date; eventId: string }`, `encodeEventCursor(cursor:
  IEventCursor): string` (base64url of a small JSON payload), `decodeEventCursor(cursor: string):
  IEventCursor` (throws `InvalidCursorError` on any malformed input — bad base64, non-JSON
  payload, or a payload failing shape validation).
- Consumed by: Task 4 (`build-events-filter.ts`), Task 5 (`search-events.ts`).

- [ ] **Step 1: Create the error class (no test — matches this repo's `errors.ts` convention)**

`back-end/service-a/src/archive/search/errors.ts`:
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

`back-end/service-a/src/archive/search/event-cursor.util.spec.ts`:
```ts
import { decodeEventCursor, encodeEventCursor } from './event-cursor.util.js';
import { InvalidCursorError } from './errors.js';

describe('encodeEventCursor / decodeEventCursor', () => {
  it('should round-trip createdAt and eventId, when a cursor is encoded then decoded', () => {
    const cursor = { createdAt: new Date('2026-08-11T00:00:00.000Z'), eventId: 'e1' };

    const decoded = decodeEventCursor(encodeEventCursor(cursor));

    expect(decoded.createdAt.toISOString()).toBe(cursor.createdAt.toISOString());
    expect(decoded.eventId).toBe(cursor.eventId);
  });

  it('should throw InvalidCursorError, when the cursor does not decode to valid JSON', () => {
    expect(() => decodeEventCursor('not-a-valid-cursor')).toThrow(InvalidCursorError);
  });

  it('should throw InvalidCursorError, when the decoded payload is missing eventId', () => {
    const payload = Buffer.from(
      JSON.stringify({ createdAt: '2026-08-11T00:00:00.000Z' }),
      'utf8',
    ).toString('base64url');

    expect(() => decodeEventCursor(payload)).toThrow(InvalidCursorError);
  });

  it('should throw InvalidCursorError, when createdAt is not an ISO datetime string', () => {
    const payload = Buffer.from(
      JSON.stringify({ createdAt: 'not-a-date', eventId: 'e1' }),
      'utf8',
    ).toString('base64url');

    expect(() => decodeEventCursor(payload)).toThrow(InvalidCursorError);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- event-cursor.util.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `event-cursor.util.ts`**

```ts
import { z } from 'zod';

import { InvalidCursorError } from './errors.js';

const cursorPayloadSchema = z.object({
  createdAt: z.iso.datetime(),
  eventId: z.string().min(1),
});

export interface IEventCursor {
  createdAt: Date;
  eventId: string;
}

export function encodeEventCursor(cursor: IEventCursor): string {
  const payload = JSON.stringify({
    createdAt: cursor.createdAt.toISOString(),
    eventId: cursor.eventId,
  });

  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeEventCursor(cursor: string): IEventCursor {
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

  return { createdAt: new Date(result.data.createdAt), eventId: result.data.eventId };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- event-cursor.util.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 7: Stage the files**

```bash
git add back-end/service-a/src/archive/search/errors.ts back-end/service-a/src/archive/search/event-cursor.util.ts back-end/service-a/src/archive/search/event-cursor.util.spec.ts
```

---

## Task 3: `service-a` — inbound search message schema

**Files:**
- Create: `back-end/service-a/src/archive/search/search-events-message.schema.ts`
- Create: `back-end/service-a/src/archive/search/search-events-message.schema.spec.ts`

**Interfaces:**
- Produces: `searchEventsMessageSchema` (Zod), `type SearchEventsMessage = { type?: string;
  repository?: string; actor?: string; from?: string; to?: string; cursor?: string; limit:
  number }` (`limit` always present after parsing — defaults to 50, capped at 200).
- Consumed by: Task 4 (`build-events-filter.ts`), Task 5 (`search-events.ts`), Task 7
  (`EventsSearchController`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-a/src/archive/search/search-events-message.schema.spec.ts`:
```ts
import { searchEventsMessageSchema } from './search-events-message.schema.js';

describe('searchEventsMessageSchema', () => {
  it('should default limit to 50, when limit is omitted', () => {
    expect(searchEventsMessageSchema.parse({}).limit).toBe(50);
  });

  it('should accept every optional filter field, when all are present and well-formed', () => {
    const message = {
      type: 'PushEvent',
      repository: 'octocat/hello-world',
      actor: 'octocat',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-11T00:00:00.000Z',
      cursor: 'some-cursor',
      limit: 25,
    };

    expect(searchEventsMessageSchema.parse(message)).toEqual(message);
  });

  it('should coerce a numeric-string limit, when it arrives as a string over the wire', () => {
    expect(searchEventsMessageSchema.parse({ limit: '25' }).limit).toBe(25);
  });

  it('should throw, when limit exceeds 200', () => {
    expect(() => searchEventsMessageSchema.parse({ limit: 201 })).toThrow();
  });

  it('should throw, when limit is zero or negative', () => {
    expect(() => searchEventsMessageSchema.parse({ limit: 0 })).toThrow();
  });

  it('should throw, when from is not an ISO datetime string', () => {
    expect(() => searchEventsMessageSchema.parse({ from: 'not-a-date' })).toThrow();
  });

  it('should throw, when type is an empty string', () => {
    expect(() => searchEventsMessageSchema.parse({ type: '' })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- search-events-message.schema.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `search-events-message.schema.ts`**

```ts
import { z } from 'zod';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export const searchEventsMessageSchema = z.object({
  type: z.string().min(1).optional(),
  repository: z.string().min(1).optional(),
  actor: z.string().min(1).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

export type SearchEventsMessage = z.infer<typeof searchEventsMessageSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- search-events-message.schema.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/archive/search/search-events-message.schema.ts back-end/service-a/src/archive/search/search-events-message.schema.spec.ts
```

---

## Task 4: `service-a` — Mongo filter builder

**Files:**
- Create: `back-end/service-a/src/archive/search/build-events-filter.ts`
- Create: `back-end/service-a/src/archive/search/build-events-filter.spec.ts`

**Interfaces:**
- Consumes: `type SearchEventsMessage` (Task 3), `type IEventCursor` (Task 2).
- Produces: `buildEventsFilter(message: SearchEventsMessage, cursor?: IEventCursor):
  Filter<IGithubEventDocument>` — pure function. Maps `type`→`eventType`,
  `repository`→`'repo.name'`, `actor`→`'actor.login'` (direct equality each); `from`/`to`→a
  `createdAt` range (`$gte`/`$lte`, either or both); when a `cursor` is given, wraps everything in
  `$and: [<field filter>, {$or: [{createdAt: {$lt}}, {createdAt: eq, eventId: {$lt}}]}]` — the
  standard descending-keyset-pagination shape matching the `{createdAt:-1, eventId:-1}` sort/index
  from Task 1.
- Consumed by: Task 5 (`search-events.ts`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-a/src/archive/search/build-events-filter.spec.ts`:
```ts
import { buildEventsFilter } from './build-events-filter.js';

describe('buildEventsFilter', () => {
  const baseMessage = { limit: 50 };

  it('should return an empty filter, when no filters or cursor are provided', () => {
    expect(buildEventsFilter(baseMessage)).toEqual({});
  });

  it('should filter by eventType, when type is provided', () => {
    expect(buildEventsFilter({ ...baseMessage, type: 'PushEvent' })).toEqual({
      eventType: 'PushEvent',
    });
  });

  it('should filter by repo.name, when repository is provided', () => {
    expect(buildEventsFilter({ ...baseMessage, repository: 'octocat/hello-world' })).toEqual({
      'repo.name': 'octocat/hello-world',
    });
  });

  it('should filter by actor.login, when actor is provided', () => {
    expect(buildEventsFilter({ ...baseMessage, actor: 'octocat' })).toEqual({
      'actor.login': 'octocat',
    });
  });

  it('should filter createdAt with only $gte, when only from is provided', () => {
    expect(buildEventsFilter({ ...baseMessage, from: '2026-08-01T00:00:00.000Z' })).toEqual({
      createdAt: { $gte: new Date('2026-08-01T00:00:00.000Z') },
    });
  });

  it('should filter createdAt with both $gte and $lte, when from and to are both provided', () => {
    expect(
      buildEventsFilter({
        ...baseMessage,
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-11T00:00:00.000Z',
      }),
    ).toEqual({
      createdAt: {
        $gte: new Date('2026-08-01T00:00:00.000Z'),
        $lte: new Date('2026-08-11T00:00:00.000Z'),
      },
    });
  });

  it('should combine every provided filter field, when all are present', () => {
    expect(
      buildEventsFilter({
        ...baseMessage,
        type: 'PushEvent',
        repository: 'octocat/hello-world',
        actor: 'octocat',
      }),
    ).toEqual({
      eventType: 'PushEvent',
      'repo.name': 'octocat/hello-world',
      'actor.login': 'octocat',
    });
  });

  it('should wrap the filter in a keyset $and/$or clause, when a cursor is provided', () => {
    const cursor = { createdAt: new Date('2026-08-11T00:00:00.000Z'), eventId: 'e1' };

    expect(buildEventsFilter({ ...baseMessage, type: 'PushEvent' }, cursor)).toEqual({
      $and: [
        { eventType: 'PushEvent' },
        {
          $or: [
            { createdAt: { $lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, eventId: { $lt: cursor.eventId } },
          ],
        },
      ],
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- build-events-filter.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `build-events-filter.ts`**

```ts
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Filter } from 'mongodb';

import { type IEventCursor } from './event-cursor.util.js';
import { type SearchEventsMessage } from './search-events-message.schema.js';

export function buildEventsFilter(
  message: SearchEventsMessage,
  cursor?: IEventCursor,
): Filter<IGithubEventDocument> {
  const filter: Filter<IGithubEventDocument> = {};

  if (message.type !== undefined) {
    filter.eventType = message.type;
  }

  if (message.repository !== undefined) {
    filter['repo.name'] = message.repository;
  }

  if (message.actor !== undefined) {
    filter['actor.login'] = message.actor;
  }

  if (message.from !== undefined || message.to !== undefined) {
    filter.createdAt = {
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
          { createdAt: { $lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, eventId: { $lt: cursor.eventId } },
        ],
      },
    ],
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- build-events-filter.spec.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/archive/search/build-events-filter.ts back-end/service-a/src/archive/search/build-events-filter.spec.ts
```

---

## Task 5: `service-a` — `searchEvents` orchestration function

**Files:**
- Create: `back-end/service-a/src/archive/search/search-events.ts`
- Create: `back-end/service-a/src/archive/search/search-events.spec.ts`

**Interfaces:**
- Consumes: `buildEventsFilter` (Task 4), `decodeEventCursor`/`encodeEventCursor` (Task 2), `type
  SearchEventsMessage` (Task 3).
- Produces: `type SearchEventsResult = { data: IGithubEventDocument[]; nextCursor?: string }`,
  `searchEvents(collection: Collection<IGithubEventDocument>, message: SearchEventsMessage):
  Promise<SearchEventsResult>` — decodes `message.cursor` if present, builds the filter, queries
  `limit + 1` documents sorted `{createdAt:-1, eventId:-1}` with `{_id: 0}` projection (Mongo
  documents never leave the persistence boundary with their `_id`), returns the first `limit`
  documents plus a `nextCursor` derived from the last of them **only** when the `limit +
  1`th document existed (proving there's a next page).
- Consumed by: Task 6 (`EventsSearchService`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-a/src/archive/search/search-events.spec.ts`:
```ts
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection } from 'mongodb';

import { encodeEventCursor } from './event-cursor.util.js';
import { searchEvents } from './search-events.js';

describe('searchEvents', () => {
  function buildDocument(eventId: string, createdAt: string): IGithubEventDocument {
    return {
      eventId,
      eventType: 'PushEvent',
      createdAt: new Date(createdAt),
      actor: { id: 1, login: 'octocat' },
      repo: { id: 2, name: 'octocat/hello-world' },
      importId: 'import-1',
      payload: {},
    };
  }

  function buildCollection(documents: IGithubEventDocument[]): {
    collection: Collection<IGithubEventDocument>;
    find: ReturnType<typeof vi.fn>;
    cursor: { sort: ReturnType<typeof vi.fn>; limit: ReturnType<typeof vi.fn> };
  } {
    const cursor = {
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(documents),
    };
    const find = vi.fn().mockReturnValue(cursor);

    return { collection: { find } as unknown as Collection<IGithubEventDocument>, find, cursor };
  }

  it('should return every document and no nextCursor, when fewer documents exist than the limit', async () => {
    const documents = [buildDocument('e1', '2026-08-11T00:02:00.000Z')];
    const { collection } = buildCollection(documents);

    const result = await searchEvents(collection, { limit: 50 });

    expect(result).toEqual({ data: documents });
  });

  it('should return a nextCursor derived from the last returned document, when more documents exist than the limit', async () => {
    const documents = [
      buildDocument('e1', '2026-08-11T00:02:00.000Z'),
      buildDocument('e2', '2026-08-11T00:01:00.000Z'),
      buildDocument('e3', '2026-08-11T00:00:00.000Z'),
    ];
    const { collection } = buildCollection(documents);

    const result = await searchEvents(collection, { limit: 2 });

    expect(result.data).toEqual(documents.slice(0, 2));
    expect(result.nextCursor).toBe(
      encodeEventCursor({
        createdAt: documents[1]?.createdAt as Date,
        eventId: documents[1]?.eventId as string,
      }),
    );
  });

  it('should query with limit + 1, sorted by createdAt/eventId descending, excluding _id, when called', async () => {
    const { collection, find, cursor } = buildCollection([]);

    await searchEvents(collection, { limit: 50 });

    expect(find).toHaveBeenCalledWith({}, { projection: { _id: 0 } });
    expect(cursor.sort).toHaveBeenCalledWith({ createdAt: -1, eventId: -1 });
    expect(cursor.limit).toHaveBeenCalledWith(51);
  });

  it('should decode the cursor and build a keyset filter, when a cursor is provided', async () => {
    const { collection, find } = buildCollection([]);
    const priorCreatedAt = new Date('2026-08-11T00:00:00.000Z');
    const priorCursor = encodeEventCursor({ createdAt: priorCreatedAt, eventId: 'e3' });

    await searchEvents(collection, { limit: 50, cursor: priorCursor });

    expect(find).toHaveBeenCalledWith(
      {
        $and: [
          {},
          {
            $or: [
              { createdAt: { $lt: priorCreatedAt } },
              { createdAt: priorCreatedAt, eventId: { $lt: 'e3' } },
            ],
          },
        ],
      },
      { projection: { _id: 0 } },
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- search-events.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `search-events.ts`**

```ts
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection } from 'mongodb';

import { buildEventsFilter } from './build-events-filter.js';
import { decodeEventCursor, encodeEventCursor } from './event-cursor.util.js';
import { type SearchEventsMessage } from './search-events-message.schema.js';

const EVENT_PROJECTION = { _id: 0 } as const;

export type SearchEventsResult = {
  data: IGithubEventDocument[];
  nextCursor?: string;
};

export async function searchEvents(
  collection: Collection<IGithubEventDocument>,
  message: SearchEventsMessage,
): Promise<SearchEventsResult> {
  const cursor = message.cursor === undefined ? undefined : decodeEventCursor(message.cursor);
  const filter = buildEventsFilter(message, cursor);

  const documents = await collection
    .find(filter, { projection: EVENT_PROJECTION })
    .sort({ createdAt: -1, eventId: -1 })
    .limit(message.limit + 1)
    .toArray();

  const hasNextPage = documents.length > message.limit;
  const data = hasNextPage ? documents.slice(0, message.limit) : documents;
  const lastEvent = data.at(-1);

  if (!hasNextPage || lastEvent === undefined) {
    return { data };
  }

  return {
    data,
    nextCursor: encodeEventCursor({ createdAt: lastEvent.createdAt, eventId: lastEvent.eventId }),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- search-events.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/archive/search/search-events.ts back-end/service-a/src/archive/search/search-events.spec.ts
```

---

## Task 6: `service-a` — `EventsSearchService` (DI wrapper)

**Files:**
- Create: `back-end/service-a/src/archive/search/events-search.service.ts`
- Create: `back-end/service-a/src/archive/search/events-search.service.spec.ts`

**Interfaces:**
- Consumes: `EVENTS_COLLECTION` (Phase 3, `../events-collection.provider.js`), `searchEvents` /
  `type SearchEventsResult` (Task 5), `type SearchEventsMessage` (Task 3).
- Produces: `EventsSearchService.search(message: SearchEventsMessage):
  Promise<SearchEventsResult>` — thin injectable wrapper, mirrors `ArchiveProcessingService`'s
  shape exactly (constructor-injects the collection, one pass-through method).
- Consumed by: Task 7 (`EventsSearchController`), Task 8 (`ArchiveModule`).

- [ ] **Step 1: Write the failing test**

`back-end/service-a/src/archive/search/events-search.service.spec.ts`:
```ts
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection } from 'mongodb';

import { EventsSearchService } from './events-search.service.js';

describe('EventsSearchService', () => {
  it('should delegate to searchEvents with the injected collection, when search is called', async () => {
    const cursor = {
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    };
    const collection = {
      find: vi.fn().mockReturnValue(cursor),
    } as unknown as Collection<IGithubEventDocument>;
    const service = new EventsSearchService(collection);

    const result = await service.search({ limit: 50 });

    expect(result).toEqual({ data: [] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- events-search.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `events-search.service.ts`**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection } from 'mongodb';

import { EVENTS_COLLECTION } from '../events-collection.provider.js';

import { type SearchEventsMessage } from './search-events-message.schema.js';
import { searchEvents, type SearchEventsResult } from './search-events.js';

@Injectable()
export class EventsSearchService {
  public constructor(
    @Inject(EVENTS_COLLECTION) private readonly collection: Collection<IGithubEventDocument>,
  ) {}

  public search(message: SearchEventsMessage): Promise<SearchEventsResult> {
    return searchEvents(this.collection, message);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- events-search.service.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/archive/search/events-search.service.ts back-end/service-a/src/archive/search/events-search.service.spec.ts
```

---

## Task 7: `service-a` — `EventsSearchController` and `ArchiveModule` wiring

**Files:**
- Create: `back-end/service-a/src/archive/search/events-search.controller.ts`
- Create: `back-end/service-a/src/archive/search/events-search.controller.spec.ts`
- Modify: `back-end/service-a/src/archive/archive.module.ts`

**Interfaces:**
- Consumes: `EventsSearchService` (Task 6), `searchEventsMessageSchema` (Task 3), `type
  SearchEventsResult` (Task 5).
- Produces: `EventsSearchController` — `@MessagePattern('events.search')`, request/reply (unlike
  `UploadImportController`'s `@EventPattern`, since the gateway needs the search results back).
- Consumed by: gateway's `EventsController` (Task 12) via `ClientProxy.send('events.search', ...)`.

- [ ] **Step 1: Write the failing tests**

`back-end/service-a/src/archive/search/events-search.controller.spec.ts`:
```ts
import { EventsSearchController } from './events-search.controller.js';
import { type EventsSearchService } from './events-search.service.js';

describe('EventsSearchController', () => {
  it('should validate the payload and delegate to EventsSearchService, when a valid message is received', async () => {
    const searchResult = { data: [] };
    const search = vi.fn().mockResolvedValue(searchResult);
    const eventsSearchService = { search } as unknown as EventsSearchService;
    const controller = new EventsSearchController(eventsSearchService);

    const result = await controller.handleSearch({ type: 'PushEvent' });

    expect(result).toBe(searchResult);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ type: 'PushEvent', limit: 50 }));
  });

  it('should reject, when the payload fails schema validation', async () => {
    const eventsSearchService = { search: vi.fn() } as unknown as EventsSearchService;
    const controller = new EventsSearchController(eventsSearchService);

    await expect(controller.handleSearch({ limit: -1 })).rejects.toThrow();
    expect(eventsSearchService.search).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- events-search.controller.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `events-search.controller.ts`**

```ts
import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';

import { EventsSearchService } from './events-search.service.js';
import { searchEventsMessageSchema } from './search-events-message.schema.js';
import { type SearchEventsResult } from './search-events.js';

@Controller()
export class EventsSearchController {
  public constructor(private readonly eventsSearchService: EventsSearchService) {}

  @MessagePattern('events.search')
  public async handleSearch(@Payload() payload: unknown): Promise<SearchEventsResult> {
    const message = searchEventsMessageSchema.parse(payload);

    return await this.eventsSearchService.search(message);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- events-search.controller.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire `EventsSearchService`/`EventsSearchController` into `ArchiveModule`**

Replace the full contents of `back-end/service-a/src/archive/archive.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { LoggerModule } from '@task1/shared/logger/rmq/logger.module';

import { EnsureEventIndexesInitializer } from './ensure-event-indexes-initializer.service.js';
import { eventsCollectionProvider } from './events-collection.provider.js';
import { EventsSearchController } from './search/events-search.controller.js';
import { EventsSearchService } from './search/events-search.service.js';
import { ArchiveProcessingService } from './upload/archive-processing.service.js';
import { UploadImportController } from './upload/upload-import.controller.js';

@Module({
  imports: [LoggerModule],
  controllers: [UploadImportController, EventsSearchController],
  providers: [
    eventsCollectionProvider,
    EnsureEventIndexesInitializer,
    ArchiveProcessingService,
    EventsSearchService,
  ],
})
export class ArchiveModule {}
```

- [ ] **Step 6: Run the full `service-a` test suite**

Run: `pnpm --filter service-a test`
Expected: PASS — every existing suite plus this phase's new specs.

- [ ] **Step 7: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 8: Stage the files**

```bash
git add back-end/service-a/src/archive/search/events-search.controller.ts back-end/service-a/src/archive/search/events-search.controller.spec.ts back-end/service-a/src/archive/archive.module.ts
```

---

## Task 8: `api-gateway` — add `rpcTimeoutMs` to `rabbitmqConfig`

**Files:**
- Modify: `back-end/api-gateway/src/config/rabbitmq.config.ts`
- Modify: `back-end/api-gateway/src/config/rabbitmq.config.spec.ts`
- Modify: `back-end/api-gateway/.env.example`

**Interfaces:**
- Produces: `rabbitmqConfig().rpcTimeoutMs: number` (`RABBITMQ_RPC_TIMEOUT_MS`, default 10000) —
  a separate timeout from the existing `pingTimeoutMs` (health checks should time out fast;
  business RPC calls like a Mongo-backed search can legitimately take longer).
- Consumed by: Task 12 (`EventsController`).

- [ ] **Step 1: Extend the failing/updated tests**

Replace the full contents of `back-end/api-gateway/src/config/rabbitmq.config.spec.ts`:
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
      delete process.env.RABBITMQ_SERVICE_B_QUEUE;
      delete process.env.RABBITMQ_SERVICE_A_QUEUE;
      delete process.env.RABBITMQ_PING_TIMEOUT_MS;
      delete process.env.RABBITMQ_RPC_TIMEOUT_MS;

      expect(rabbitmqConfig()).toEqual({
        url: 'amqp://guest:guest@localhost:5672',
        serviceBQueue: 'service_b_queue',
        serviceAQueue: 'service_a_queue',
        pingTimeoutMs: 3000,
        rpcTimeoutMs: 10_000,
      });
    });
  });

  describe('environment overrides', () => {
    it('should parse values from environment variables, when all variables are set', () => {
      process.env.RABBITMQ_URL = 'amqp://user:pass@rabbit-host:5672';
      process.env.RABBITMQ_SERVICE_B_QUEUE = 'custom_service_b_queue';
      process.env.RABBITMQ_SERVICE_A_QUEUE = 'custom_service_a_queue';
      process.env.RABBITMQ_PING_TIMEOUT_MS = '5000';
      process.env.RABBITMQ_RPC_TIMEOUT_MS = '15000';

      expect(rabbitmqConfig()).toEqual({
        url: 'amqp://user:pass@rabbit-host:5672',
        serviceBQueue: 'custom_service_b_queue',
        serviceAQueue: 'custom_service_a_queue',
        pingTimeoutMs: 5000,
        rpcTimeoutMs: 15_000,
      });
    });
  });

  describe('validation', () => {
    it('should throw, when RABBITMQ_URL is not a valid url', () => {
      process.env.RABBITMQ_URL = 'not-a-valid-url';

      expect(() => rabbitmqConfig()).toThrow();
    });

    it('should throw, when RABBITMQ_SERVICE_B_QUEUE is an empty string', () => {
      process.env.RABBITMQ_SERVICE_B_QUEUE = '';

      expect(() => rabbitmqConfig()).toThrow();
    });

    it('should throw, when RABBITMQ_SERVICE_A_QUEUE is an empty string', () => {
      process.env.RABBITMQ_SERVICE_A_QUEUE = '';

      expect(() => rabbitmqConfig()).toThrow();
    });

    it('should throw, when RABBITMQ_PING_TIMEOUT_MS is not a positive number', () => {
      process.env.RABBITMQ_PING_TIMEOUT_MS = '-1';

      expect(() => rabbitmqConfig()).toThrow();
    });

    it('should throw, when RABBITMQ_RPC_TIMEOUT_MS is not a positive number', () => {
      process.env.RABBITMQ_RPC_TIMEOUT_MS = '-1';

      expect(() => rabbitmqConfig()).toThrow();
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `pnpm --filter api-gateway test -- rabbitmq.config.spec.ts`
Expected: FAIL — `rpcTimeoutMs` is `undefined`/missing from the parsed config.

- [ ] **Step 3: Implement the config change**

Replace the full contents of `back-end/api-gateway/src/config/rabbitmq.config.ts`:
```ts
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const rabbitmqConfigSchema = z.object({
  url: z.url().default('amqp://guest:guest@localhost:5672'),
  serviceBQueue: z.string().min(1).default('service_b_queue'),
  serviceAQueue: z.string().min(1).default('service_a_queue'),
  pingTimeoutMs: z.coerce.number().int().positive().default(3000),
  rpcTimeoutMs: z.coerce.number().int().positive().default(10_000),
});

export type RabbitmqConfiguration = z.infer<typeof rabbitmqConfigSchema>;

export default registerAs('rabbitmq', (): RabbitmqConfiguration =>
  rabbitmqConfigSchema.parse({
    url: process.env.RABBITMQ_URL,
    serviceBQueue: process.env.RABBITMQ_SERVICE_B_QUEUE,
    serviceAQueue: process.env.RABBITMQ_SERVICE_A_QUEUE,
    pingTimeoutMs: process.env.RABBITMQ_PING_TIMEOUT_MS,
    rpcTimeoutMs: process.env.RABBITMQ_RPC_TIMEOUT_MS,
  }),
);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter api-gateway test -- rabbitmq.config.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Document the new environment variable**

Append to `back-end/api-gateway/.env.example` (after the existing
`RABBITMQ_PING_TIMEOUT_MS` line, if present, otherwise after the RabbitMQ section):
```
RABBITMQ_RPC_TIMEOUT_MS=10000
```

- [ ] **Step 6: Lint**

Run: `pnpm --filter api-gateway lint`
Expected: PASS.

- [ ] **Step 7: Stage the files**

```bash
git add back-end/api-gateway/src/config/rabbitmq.config.ts back-end/api-gateway/src/config/rabbitmq.config.spec.ts back-end/api-gateway/.env.example
```

---

## Task 9: `api-gateway` — `SearchEventsQueryDto`

**Files:**
- Create: `back-end/api-gateway/src/events/dto/search-events-query.dto.ts`
- Create: `back-end/api-gateway/src/events/dto/search-events-query.dto.spec.ts`

**Interfaces:**
- Produces: `SearchEventsQueryDto { type?: string; repository?: string; actor?: string; from?:
  string; to?: string; cursor?: string; limit: number }` (`limit` defaults to 50 via a class
  field initializer, capped at 200) — validated by the gateway's existing global `ValidationPipe`
  (`whitelist: true, transform: true, forbidNonWhitelisted: true`, registered in `main.ts`).
- Consumed by: Task 12 (`EventsController`).

- [ ] **Step 1: Write the failing tests**

`back-end/api-gateway/src/events/dto/search-events-query.dto.spec.ts`:
```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SearchEventsQueryDto } from './search-events-query.dto.js';

describe('SearchEventsQueryDto', () => {
  it('should default limit to 50 and produce no validation errors, when no query params are provided', async () => {
    const dto = plainToInstance(SearchEventsQueryDto, {});

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(50);
  });

  it('should produce no validation errors, when every field is well-formed', async () => {
    const dto = plainToInstance(SearchEventsQueryDto, {
      type: 'PushEvent',
      repository: 'octocat/hello-world',
      actor: 'octocat',
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
    const dto = plainToInstance(SearchEventsQueryDto, { limit: '201' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
  });

  it('should produce a validation error, when limit is zero', async () => {
    const dto = plainToInstance(SearchEventsQueryDto, { limit: '0' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
  });

  it('should produce a validation error, when from is not a valid ISO-8601 string', async () => {
    const dto = plainToInstance(SearchEventsQueryDto, { from: 'not-a-date' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter api-gateway test -- search-events-query.dto.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `search-events-query.dto.ts`**

```ts
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class SearchEventsQueryDto {
  @IsOptional()
  @IsString()
  public readonly type?: string;

  @IsOptional()
  @IsString()
  public readonly repository?: string;

  @IsOptional()
  @IsString()
  public readonly actor?: string;

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

Run: `pnpm --filter api-gateway test -- search-events-query.dto.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter api-gateway lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/api-gateway/src/events/dto/search-events-query.dto.ts back-end/api-gateway/src/events/dto/search-events-query.dto.spec.ts
```

---

## Task 10: `api-gateway` — response DTOs

**Files:**
- Create: `back-end/api-gateway/src/events/dto/event-response.dto.ts`
- Create: `back-end/api-gateway/src/events/dto/search-events-response.dto.ts`

**Interfaces:**
- Consumes: `type IGithubActor`, `type IGithubEventDocument`, `type IGithubOrganization`, `type
  IGithubRepository` (`@task1/shared/github-archive/index`).
- Produces: `EventResponseDto` (constructor: `(document: Omit<IGithubEventDocument, 'createdAt'>
  & { createdAt: string })` — see Global Constraints Finding 2 for why `createdAt` arrives as a
  `string`, not a `Date`, at this point). `SearchEventsResponseDto` (constructor: `(data:
  EventResponseDto[], nextCursor?: string)`).
- Consumed by: Task 12 (`EventsController`).

This task has no dedicated unit test of its own — both are plain data-mapping classes with no
branching logic, matching `UploadImportResponseDto`'s precedent (no test file); their shape is
exercised by Task 13's integration test.

- [ ] **Step 1: Implement `event-response.dto.ts`**

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  type IGithubActor,
  type IGithubEventDocument,
  type IGithubOrganization,
  type IGithubRepository,
} from '@task1/shared/github-archive/index';

export class EventResponseDto {
  @ApiProperty({ example: '11111111111' })
  public readonly eventId: string;

  @ApiProperty({ example: 'PushEvent' })
  public readonly eventType: string;

  @ApiProperty({ example: '2026-08-11T00:00:00.000Z' })
  public readonly createdAt: string;

  @ApiProperty({ example: { id: 1, login: 'octocat' } })
  public readonly actor: IGithubActor;

  @ApiProperty({ example: { id: 2, name: 'octocat/hello-world' } })
  public readonly repo: IGithubRepository;

  @ApiPropertyOptional({ example: { id: 3, login: 'octo-org' } })
  public readonly org?: IGithubOrganization;

  @ApiProperty({ example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  public readonly importId: string;

  @ApiProperty({ type: Object, example: { ref: 'refs/heads/main', commitCount: 3 } })
  public readonly payload: Record<string, unknown>;

  public constructor(document: Omit<IGithubEventDocument, 'createdAt'> & { createdAt: string }) {
    this.eventId = document.eventId;
    this.eventType = document.eventType;
    this.createdAt = document.createdAt;
    this.actor = document.actor;
    this.repo = document.repo;
    this.importId = document.importId;
    this.payload = document.payload;

    if (document.org !== undefined) {
      this.org = document.org;
    }
  }
}
```

- [ ] **Step 2: Implement `search-events-response.dto.ts`**

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { EventResponseDto } from './event-response.dto.js';

export class SearchEventsResponseDto {
  @ApiProperty({ type: [EventResponseDto] })
  public readonly data: EventResponseDto[];

  @ApiPropertyOptional({
    description: 'Opaque cursor for the next page; absent when no more results exist',
    example: 'eyJjcmVhdGVkQXQiOiIyMDI2LTA4LTExVDAwOjAwOjAwLjAwMFoiLCJldmVudElkIjoiZTEifQ',
  })
  public readonly nextCursor?: string;

  public constructor(data: EventResponseDto[], nextCursor?: string) {
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
git add back-end/api-gateway/src/events/dto/event-response.dto.ts back-end/api-gateway/src/events/dto/search-events-response.dto.ts
```

---

## Task 11: `api-gateway` — `SERVICE_A_RMQ_CLIENT` token and `EventsModule`

**Files:**
- Create: `back-end/api-gateway/src/events/rabbitmq-client.token.ts`
- Create: `back-end/api-gateway/src/events/events.module.ts`

**Interfaces:**
- Consumes: `rabbitmqConfig` (Task 8).
- Produces: `SERVICE_A_RMQ_CLIENT` (string DI token, module-scoped to `EventsModule` — see Global
  Constraints for why this duplicates `ImportsModule`'s own copy rather than sharing it),
  `EventsModule` (registers the RMQ client, declares `EventsController`).
- Consumed by: Task 12 (`EventsController`), Task 13 (integration test), Task 14 (`app.module.ts`).

This task has no dedicated unit test of its own — `ClientsModule.registerAsync` is framework
wiring, exercised end-to-end by Task 13's integration test (matching `ImportsModule`'s
precedent).

- [ ] **Step 1: Create the token file**

`back-end/api-gateway/src/events/rabbitmq-client.token.ts`:
```ts
export const SERVICE_A_RMQ_CLIENT = 'SERVICE_A_RMQ_CLIENT';
```

- [ ] **Step 2: Implement `events.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';

import rabbitmqConfig from '../config/rabbitmq.config.js';

import { EventsController } from './events.controller.js';
import { SERVICE_A_RMQ_CLIENT } from './rabbitmq-client.token.js';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: SERVICE_A_RMQ_CLIENT,
        inject: [rabbitmqConfig.KEY],
        useFactory: (config: ConfigType<typeof rabbitmqConfig>) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.url],
            queue: config.serviceAQueue,
            queueOptions: { durable: true },
          },
        }),
      },
    ]),
  ],
  controllers: [EventsController],
})
export class EventsModule {}
```

- [ ] **Step 3: Lint**

Run: `pnpm --filter api-gateway lint`
Expected: PASS (will fail until Task 12 creates `events.controller.ts` — proceed to Task 12
before running this if executing tasks strictly in order; both are commonly implemented and
linted together).

- [ ] **Step 4: Stage the files**

```bash
git add back-end/api-gateway/src/events/rabbitmq-client.token.ts back-end/api-gateway/src/events/events.module.ts
```

---

## Task 12: `api-gateway` — `EventsController`

**Files:**
- Create: `back-end/api-gateway/src/events/events.controller.ts`

**Interfaces:**
- Consumes: `SERVICE_A_RMQ_CLIENT` (Task 11), `SearchEventsQueryDto` (Task 9),
  `EventResponseDto`/`SearchEventsResponseDto` (Task 10), `rabbitmqConfig` (Task 8),
  `buildOutboundHeaders`/`RequestContextService` (`@task1/shared/request-context`, existing —
  same as `RabbitMqPingHealthIndicator`'s precedent).
- Produces: `EventsController` — `GET /events` (full runtime path `/api/v1/events` once
  `main.ts`'s global prefix/versioning apply).
- Consumed by: Task 11 (`EventsModule.controllers`), Task 13 (integration test).

This is the first business-RPC (`send()`, request/reply) call site in this codebase outside the
health check; there is no unit-test-only path for it (it has an HTTP listener and a live RMQ
client dependency) — per the testing skill, it gets an `.int.spec.ts` (Task 13) instead of a
`.spec.ts`.

- [ ] **Step 1: Implement `events.controller.ts`**

```ts
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { buildOutboundHeaders } from '@task1/shared/request-context/propagation.util';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { firstValueFrom, timeout } from 'rxjs';

import rabbitmqConfig from '../config/rabbitmq.config.js';

import { EventResponseDto } from './dto/event-response.dto.js';
import { SearchEventsQueryDto } from './dto/search-events-query.dto.js';
import { SearchEventsResponseDto } from './dto/search-events-response.dto.js';
import { SERVICE_A_RMQ_CLIENT } from './rabbitmq-client.token.js';

type SearchEventsRpcEvent = Omit<IGithubEventDocument, 'createdAt'> & { createdAt: string };
type SearchEventsRpcResult = { data: SearchEventsRpcEvent[]; nextCursor?: string };

const EVENTS_SEARCH_PATTERN = 'events.search';

@ApiTags('events')
@Controller('events')
export class EventsController {
  public constructor(
    @Inject(SERVICE_A_RMQ_CLIENT) private readonly serviceAClient: ClientProxy,
    private readonly requestContextService: RequestContextService,
    @Inject(rabbitmqConfig.KEY)
    private readonly rabbitmqConfiguration: ConfigType<typeof rabbitmqConfig>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Search imported GitHub events with filters and cursor pagination' })
  @ApiQuery({ name: 'type', required: false, description: 'GitHub event type, e.g. PushEvent' })
  @ApiQuery({
    name: 'repository',
    required: false,
    description: 'Repository full name, e.g. octocat/hello-world',
  })
  @ApiQuery({ name: 'actor', required: false, description: 'Actor login' })
  @ApiQuery({ name: 'from', required: false, description: 'ISO-8601 lower bound for createdAt' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO-8601 upper bound for createdAt' })
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
  @ApiOkResponse({ type: SearchEventsResponseDto })
  public async search(@Query() query: SearchEventsQueryDto): Promise<SearchEventsResponseDto> {
    const headers = buildOutboundHeaders(this.requestContextService.requireContext());
    const record = new RmqRecordBuilder(query).setOptions({ headers }).build();

    const result = await firstValueFrom(
      this.serviceAClient
        .send<SearchEventsRpcResult>(EVENTS_SEARCH_PATTERN, record)
        .pipe(timeout(this.rabbitmqConfiguration.rpcTimeoutMs)),
    );

    const data = result.data.map((event) => new EventResponseDto(event));

    return new SearchEventsResponseDto(data, result.nextCursor);
  }
}
```

- [ ] **Step 2: Lint both Task 11 and Task 12 files together**

Run: `pnpm --filter api-gateway lint`
Expected: PASS.

- [ ] **Step 3: Stage the file**

```bash
git add back-end/api-gateway/src/events/events.controller.ts
```

---

## Task 13: `api-gateway` — `EventsController` integration test

**Files:**
- Create: `back-end/api-gateway/src/events/events.controller.int.spec.ts`

**Interfaces:**
- Consumes: `EventsModule` (Task 11), `SERVICE_A_RMQ_CLIENT` (Task 11), `AuthGuard`/`AuthModule`
  (existing), `rabbitmqConfig` (Task 8).

- [ ] **Step 1: Write the failing integration tests**

`back-end/api-gateway/src/events/events.controller.int.spec.ts`:
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

import { EventsModule } from './events.module.js';
import { SERVICE_A_RMQ_CLIENT } from './rabbitmq-client.token.js';

type App = Parameters<typeof request>[0];

describe('EventsController (HTTP Integration)', () => {
  let app: INestApplication;
  let httpServer: App;
  let serviceAClient: { send: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    serviceAClient = { send: vi.fn() };

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
        EventsModule,
      ],
    })
      .overrideProvider(SERVICE_A_RMQ_CLIENT)
      .useValue(serviceAClient as unknown as ClientProxy)
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

  describe('GET /events', () => {
    it('should return 200 with the mapped events and nextCursor, when service-a replies successfully', async () => {
      serviceAClient.send.mockReturnValue(
        of({
          data: [
            {
              eventId: 'e1',
              eventType: 'PushEvent',
              createdAt: '2026-08-11T00:00:00.000Z',
              actor: { id: 1, login: 'octocat' },
              repo: { id: 2, name: 'octocat/hello-world' },
              importId: 'import-1',
              payload: { ref: 'refs/heads/main', commitCount: 1 },
            },
          ],
          nextCursor: 'some-cursor',
        }),
      );

      const response = await request(httpServer).get('/events').query({ type: 'PushEvent' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        data: [
          {
            eventId: 'e1',
            eventType: 'PushEvent',
            createdAt: '2026-08-11T00:00:00.000Z',
            actor: { id: 1, login: 'octocat' },
            repo: { id: 2, name: 'octocat/hello-world' },
            importId: 'import-1',
            payload: { ref: 'refs/heads/main', commitCount: 1 },
          },
        ],
        nextCursor: 'some-cursor',
      });
    });

    it('should forward the query filters and default limit inside the RMQ message, when a search is performed', async () => {
      serviceAClient.send.mockReturnValue(of({ data: [] }));

      await request(httpServer).get('/events').query({ type: 'PushEvent' });

      const [pattern, record] = serviceAClient.send.mock.calls[0] as [
        string,
        { data: { type: string; limit: number } },
      ];
      expect(pattern).toBe('events.search');
      expect(record.data).toEqual(expect.objectContaining({ type: 'PushEvent', limit: 50 }));
    });

    it('should send a message record whose headers include a correlation id, when a search is performed', async () => {
      serviceAClient.send.mockReturnValue(of({ data: [] }));

      await request(httpServer).get('/events');

      const [, record] = serviceAClient.send.mock.calls[0] as [
        string,
        { options: { headers: Record<string, string> } },
      ];
      expect(typeof record.options.headers['x-correlation-id']).toBe('string');
    });

    it('should return 400 and not call service-a, when limit exceeds 200', async () => {
      const response = await request(httpServer).get('/events').query({ limit: '201' });

      expect(response.status).toBe(400);
      expect(serviceAClient.send).not.toHaveBeenCalled();
    });

    it('should return 400 and not call service-a, when an unknown query parameter is provided', async () => {
      const response = await request(httpServer).get('/events').query({ unknown: 'value' });

      expect(response.status).toBe(400);
      expect(serviceAClient.send).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter api-gateway test -- events.controller.int.spec.ts`
Expected: FAIL (module not found, until Tasks 11/12 exist — if run after them, this validates the
real implementation and should already pass; if any assertion fails, fix the controller/module
before proceeding).

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm --filter api-gateway test -- events.controller.int.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 4: Lint**

Run: `pnpm --filter api-gateway lint`
Expected: PASS.

- [ ] **Step 5: Stage the file**

```bash
git add back-end/api-gateway/src/events/events.controller.int.spec.ts
```

---

## Task 14: `api-gateway` — wire `EventsModule` into `app.module.ts`

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

## Task 15: End-to-end verification

**Files:** none — this task only runs commands and reads output, the "does everything actually
connect" checkpoint the earlier unit/integration tests (all mocked, per this repo's testing
convention) can't cover.

- [ ] **Step 1: Build all workspace packages**

Run: `pnpm build`
Expected: succeeds for `@task1/shared`, `service-a`, `service-b`, `api-gateway`, `front-end`.

- [ ] **Step 2: Run every package's test suite**

Run: `pnpm --filter service-a test && pnpm --filter api-gateway test`
Expected: both PASS.

- [ ] **Step 3: Lint every touched package**

Run: `pnpm --filter service-a lint && pnpm --filter api-gateway lint`
Expected: both PASS.

- [ ] **Step 4: Start the full stack**

Run: `pnpm docker:up`
Expected: all containers reach a healthy/running state.

- [ ] **Step 5: Confirm the search endpoint is reachable and the new indexes exist**

Run: `docker compose exec mongodb mongosh service_a --quiet --eval "db.events.getIndexes().length"`
Expected: `5` (the unique `eventId` index plus the four indexes this phase added).

Run:
```bash
curl -s "http://localhost:3000/api/v1/events?limit=5"
```
Expected: a JSON body shaped `{"data": [...], "nextCursor": "..." }` (or `{"data": []}` if no
archive has been imported yet in this environment) — **not** a 403 (the gateway's `AuthGuard`
currently denies all non-`@Public()` routes unconditionally; getting a real response here, rather
than 403, would mean a real auth provider now exists — if this returns 403, that is the current,
expected, documented behavior of the fail-closed auth stub, not a bug in this phase).

- [ ] **Step 6: Tear down**

Run: `pnpm docker:down`
Expected: all containers stop cleanly.

---

## Self-Review

**Spec coverage:** the design doc's "Service-a: search API & pagination (Phase 4)" section maps
entirely to Tasks 1–14: cursor pagination via `{createdAt, eventId}` keyset (Tasks 2, 4, 5),
whitelist-of-filter-keys query validation (Task 9), `limit` capped at 200 (Tasks 3, 9), filtering
and sorting entirely inside MongoDB with never more than one page loaded into Node (Task 5), the
gateway forwarding a small DTO via RMQ RPC and mapping the response with Swagger decorators (Tasks
11, 12). The design doc's "Data model" indexes for the `events` collection are completed by Task
1 (the three query-pattern indexes plus the default pagination index Phase 2 deliberately
deferred to this phase).

**Placeholder scan:** no TBD/TODO; every step shows complete file contents or an exact runnable
command with expected output.

**Type/name consistency:** `SearchEventsMessage` (Task 3) is consumed unchanged by
`build-events-filter.ts` (Task 4), `search-events.ts` (Task 5), and
`events-search.controller.ts` (Task 7). `SearchEventsResult` (Task 5) is consumed unchanged by
`EventsSearchService` (Task 6) and is the shape `EventsSearchController.handleSearch` (Task 7)
returns. `IEventCursor` (Task 2) is consumed unchanged by `build-events-filter.ts` and
`search-events.ts`. On the gateway side, `SearchEventsQueryDto` (Task 9) is the exact shape sent
as the RMQ message body (Task 12), matching `SearchEventsMessage`'s field names (`type`,
`repository`, `actor`, `from`, `to`, `cursor`, `limit`) so `service-a`'s Zod schema validates
exactly what the gateway sends, with no field-name translation layer in between.
