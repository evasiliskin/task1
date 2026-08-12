# Phase 2: Service-a Archive Processing Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `processArchive(filePath, importId, options, onInvalidLine?): Promise<ImportResult>` —
streams a `.json.gz` GitHub Archive file from disk through gunzip → NDJSON line-split →
parse/validate → per-event-type whitelist transform → batch → unordered bulk Mongo insert,
memory-bounded regardless of file size (never a full-file buffer, never a full-file array of
events), counting (never accumulating) invalid lines, newly-inserted events, duplicate-key
hits, and other per-document write errors.

**Architecture:** A new `back-end/service-a/src/archive/processing/` module with one file per
pipeline stage — `split-lines.ts`, `raw-github-event.schema.ts`, `parse-and-validate.ts`,
`transform-event.ts`, `batch-events.ts`, `insert-batch.ts`, `ensure-event-indexes.ts`,
`errors.ts` — plus `process-archive.ts`, the orchestration function wiring them together, per
this repo's existing step-function/orchestration-function split (same shape as Phase 1's
`archive/download/`). Node's `node:stream`'s `compose()` joins the file-read stream and the
gunzip transform into one safely-iterable stream (see Global Constraints for why plain
`.pipe()` is not safe here); everything after that is plain async generators chained by
direct function calls (no stream machinery needed once we're past raw bytes). No NestJS
wiring, no controller, no RMQ handler, no Mongo/Redis client construction — this phase is
pure, directly callable, fully unit-testable in isolation, matching Phase 1's already-approved
scope note. Phase 5 wires this into the real import orchestration (RMQ handler, real
`MONGO_CLIENT`-derived `Collection`, `mongodbConfig().batchSize`, `LoggerService` for
`onInvalidLine`).

**Tech Stack:** Node's built-in `node:fs`/`node:stream`/`node:zlib` only — no new npm
dependency (`mongodb@7.5.0` is already a `service-a` dependency from Phase 0). Zod (already
present). Vitest.

**Design doc:** `docs/superpowers/specs/2026-08-12-github-archive-platform-design.md`
(section "Service-a: processing pipeline (Phase 2, shared by download + upload)", plus the
`events` collection part of "Data model (service-a, MongoDB)")
**Roadmap:** `docs/superpowers/plans/2026-08-12-github-archive-platform-plan.md` (Phase 2 of 11)
**Depends on:** Phase 0 (`@task1/shared/github-archive/*` contracts, `MONGO_CLIENT`
provider — already merged) and Phase 1 (`archive/download/` — already merged; this phase
does not import anything from it, but `processArchive`'s `filePath` parameter is the exact
shape `downloadArchive`'s `IDownloadArchiveResult.filePath` produces).

Every function signature and every driver-specific detail below was verified against this
exact codebase and the installed `mongodb@7.5.0` package's own type declarations and compiled
source (`node_modules/.pnpm/mongodb@7.5.0*/node_modules/mongodb/lib/bulk/common.js`,
`mongodb.d.ts`) and current Zod v4 / Node 24 documentation before this plan was written — not
guessed. Three non-obvious findings are called out below because they will otherwise cost
real time or cause a subtly wrong implementation during execution.

## Global Constraints

- Never throw raw `Error` — `ArchiveProcessingError` (new,
  `back-end/service-a/src/archive/processing/errors.ts`) extends `AppError` directly (same
  pattern as Phase 1's `ArchiveDownloadError`, not `ValidationError`/`InternalError` — it
  wraps a genuine external-dependency failure: a broken MongoDB write or a corrupt/unreadable
  archive file, not a caller-input validation problem).
- **Finding 1 — plain `.pipe()` between `createReadStream` and `createGunzip()` silently
  drops read-stream errors.** `readable.pipe(destination)` does **not** forward `'error'`
  events from the source to the destination — that's `stream.pipeline()`'s/`stream.compose()`'s
  job, not `.pipe()`'s (confirmed against Node 24 stream docs). If `filePath` doesn't exist
  (`ENOENT`) or the disk read fails mid-file, a bare `.pipe()` chain leaves that error
  unhandled on the source stream, which crashes the process (Node throws on an unhandled
  EventEmitter `'error'` event) instead of rejecting `processArchive`'s returned promise.
  **Task 8 uses `node:stream`'s `compose(createReadStream(filePath), createGunzip())`**
  instead, which combines both into one Duplex and destroys/propagates errors from either
  side correctly — confirmed against Node 24's `stream.compose` documentation ("Combines two
  or more streams into a Duplex stream... handles errors by destroying all streams in the
  chain"). Task 8's tests cover both failure sources (nonexistent file → source-stream error;
  corrupt gzip content → transform-stream error) specifically because this bug would only
  surface on the first one.
- **Finding 2 — the `mongodb` driver's `MongoBulkWriteError` cannot be constructed in tests
  the normal way.** Its constructor takes a `result: BulkWriteResult` parameter, but
  `BulkWriteResult`'s own constructor is excluded from the package's public type declarations
  (`/* Excluded from this release type: __constructor */` in `mongodb.d.ts`) — so
  `new MongoBulkWriteError(..., new BulkWriteResult(...))` does not type-check from
  application/test code, and the class is explicitly documented "**Do not use this
  constructor!** ... internal use only". Reading the driver's actual compiled source
  (`lib/bulk/common.js`) confirms `MongoBulkWriteError extends MongoServerError`, overrides
  `get name() { return 'MongoBulkWriteError'; }`, exposes `writeErrors` as a plain instance
  property, and exposes `insertedCount` as a getter delegating to `this.result.insertedCount`.
  **`insert-batch.ts`'s error narrowing therefore checks `error instanceof Error &&
  error.name === 'MongoBulkWriteError'`** (duck-typing on the same `name` value the real
  driver's getter returns) instead of `instanceof MongoBulkWriteError` — this is exactly as
  correct against a real thrown error (whose `.name` getter really does return that string)
  and, unlike `instanceof`, is constructible in tests as a plain object literal
  (`Object.assign(new Error(...), { name: 'MongoBulkWriteError', insertedCount, writeErrors })`
  cast `as unknown as MongoBulkWriteError`), matching this repo's established mocking
  convention (see Phase 0's Global Constraints: "never `vi.mock()`").
- **Finding 3 — `writeErrors` is `WriteError | ReadonlyArray<WriteError>`, not always an
  array** (`export declare type OneOrMore<T> = T | ReadonlyArray<T>;` in `mongodb.d.ts`).
  `insert-batch.ts` normalizes with `Array.isArray(error.writeErrors) ? error.writeErrors :
  [error.writeErrors]` before counting — omitting this would throw on a batch with exactly
  one write error (the exact case the "1 duplicate out of a batch of 1" scenario in Task 8's
  pipeline test exercises).
- A **batch write failure is only ever a partial, per-document failure that still lets the
  batch complete** — when the MongoDB driver's `insertMany(..., { ordered: false })` call
  itself succeeds (even with some documents rejected — duplicate key or otherwise), it throws
  `MongoBulkWriteError`, which `insert-batch.ts` catches and turns into counted
  `duplicateEvents`/`errorCount` (never re-thrown, processing continues onto the next batch —
  per the design doc's `IssuesEvent`/duplicate-handling intent, `ImportCompletedEvent` still
  fires with a non-zero `errorCount`). A **different** thrown error (connection loss, auth
  failure, disk-full on the Mongo side, or any stream/gunzip/parse-stage failure upstream of
  the insert) is **not** a `MongoBulkWriteError`, is never swallowed, and propagates out of
  `processArchive` wrapped in `ArchiveProcessingError` — matching the design doc's error table
  ("MongoDB write failure (batch) | Propagates as a processing error... already-inserted
  batches are not rolled back").
- `unicorn/prevent-abbreviations` rejects short local variable/parameter names — use full
  words (see Phase 1's Global Constraints for the exact rule and its one exception for
  property keys that must match an external interface field name).
- `security/detect-non-literal-fs-filename` fires on `createReadStream(filePath)` — every
  such call in this plan carries a justified
  `// eslint-disable-next-line security/detect-non-literal-fs-filename -- <reason>` comment;
  copy it verbatim.
- Type-only imports use inline `type` modifiers; relative imports use explicit `.js`
  extensions; imports grouped (builtin/external/internal/parent/sibling/index), alphabetized
  ascending case-insensitive, blank line between groups. `@task1/shared/github-archive/index`
  and `mongodb` both count as "external" for grouping purposes (verified against this repo's
  `import-x/order` config and Phase 0/1's own import blocks — neither uses a path-alias
  "internal" group).
- Naming: `interface`s are `PascalCase` prefixed with `I` (e.g. `IProcessArchiveOptions`,
  `IInsertBatchResult` — newly-introduced option/result bags with no prior binding name,
  exactly like Phase 1's `IDownloadArchiveOptions`/`IDownloadArchiveResult`). `type` aliases
  are `PascalCase` with **no** prefix — this includes every `z.infer<...>` result (matching
  Phase 0's `ImportStartedEvent`/`ArchiveConfiguration` convention) **and** `ImportResult`
  specifically, because the roadmap's own Self-Review explicitly commits to reusing the bare
  name `ImportResult` unchanged in Phase 5 — it is declared as a `type`, not an `interface`,
  so that exact unprefixed name is lint-clean.
- Blank line required before every `return`/`throw` following a `const`/`let`/`var` or
  expression statement, and before every `if`.
- No `git commit` restriction in this plan's execution worktree — per this repo's established
  convention (see Phase 0/1), commits inside an isolated implementation worktree are expected.
- BDD test naming: `it('should X, when Y')`. Coverage thresholds: 90% lines, 90% branches.
- No dedicated `*.spec.ts` file is written for `errors.ts` — matches this repo's existing
  convention (`ArchiveDownloadError` has none either); `ArchiveProcessingError`'s
  throw-behavior is exercised indirectly by Task 8's failure-path tests.
- This phase creates **only** the `events` collection's unique `{ eventId: 1 }` index — the
  one this phase's own duplicate-detection feature is functionally meaningless without (an
  `insertMany` can never produce an `E11000` without a unique index backing it, so without
  this, `insert-batch.ts`'s duplicate-counting path would never fire against a real database).
  The three query-pattern indexes the design doc's "Data model" section also documents
  (`{ eventType: 1, createdAt: -1 }`, `{ 'repo.name': 1, createdAt: -1 }`,
  `{ 'actor.login': 1, createdAt: -1 }`) and the default pagination index
  (`{ createdAt: -1, eventId: -1 }`) are **not** created here — nothing in this phase queries
  the collection, so creating them now would be speculative; they belong to Phase 4 (search
  API), which is where they're actually needed and tested.

---

## Task 1: `service-a` — NDJSON line splitter

**Files:**
- Create: `back-end/service-a/src/archive/processing/split-lines.ts`
- Create: `back-end/service-a/src/archive/processing/split-lines.spec.ts`

**Interfaces:**
- Produces: `splitLines(source: AsyncIterable<Buffer>): AsyncGenerator<string>` — yields each
  non-empty line (trailing `\r` stripped, so both `\n` and `\r\n` line endings work), buffering
  only the current trailing partial line between chunks — bounded memory regardless of total
  file size. Flushes a final trailing line with no terminating newline.
- Consumed by: Task 3 (`parse-and-validate.ts`), Task 9 (`process-archive.ts`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-a/src/archive/processing/split-lines.spec.ts`:
```ts
import { splitLines } from './split-lines.js';

describe('splitLines', () => {
  async function* fromChunks(chunks: string[]): AsyncGenerator<Buffer> {
    for (const chunk of chunks) {
      yield Buffer.from(chunk);
    }
  }

  async function collect(source: AsyncGenerator<string>): Promise<string[]> {
    const lines: string[] = [];

    for await (const line of source) {
      lines.push(line);
    }

    return lines;
  }

  it('should yield each line, when a chunk contains multiple newline-terminated lines', async () => {
    const lines = await collect(splitLines(fromChunks(['line1\nline2\nline3\n'])));

    expect(lines).toEqual(['line1', 'line2', 'line3']);
  });

  it('should yield the correct line, when a single line is split across two chunks', async () => {
    const lines = await collect(splitLines(fromChunks(['line1\nli', 'ne2\nline3\n'])));

    expect(lines).toEqual(['line1', 'line2', 'line3']);
  });

  it('should yield the trailing content, when the final chunk has no terminating newline', async () => {
    const lines = await collect(splitLines(fromChunks(['line1\nline2'])));

    expect(lines).toEqual(['line1', 'line2']);
  });

  it('should strip a trailing carriage return, when lines use CRLF endings', async () => {
    const lines = await collect(splitLines(fromChunks(['line1\r\nline2\r\n'])));

    expect(lines).toEqual(['line1', 'line2']);
  });

  it('should skip blank lines, when consecutive newlines produce an empty line', async () => {
    const lines = await collect(splitLines(fromChunks(['line1\n\nline2\n'])));

    expect(lines).toEqual(['line1', 'line2']);
  });

  it('should yield nothing, when the source is empty', async () => {
    const lines = await collect(splitLines(fromChunks([])));

    expect(lines).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- split-lines.spec.ts`
Expected: FAIL — `Cannot find module './split-lines.js'`.

- [ ] **Step 3: Implement `split-lines.ts`**

```ts
export async function* splitLines(source: AsyncIterable<Buffer>): AsyncGenerator<string> {
  let remainder = '';

  for await (const chunk of source) {
    remainder += chunk.toString('utf8');

    let newlineIndex = remainder.indexOf('\n');

    while (newlineIndex !== -1) {
      const line = remainder.slice(0, newlineIndex).replace(/\r$/, '');
      remainder = remainder.slice(newlineIndex + 1);

      if (line.length > 0) {
        yield line;
      }

      newlineIndex = remainder.indexOf('\n');
    }
  }

  const finalLine = remainder.replace(/\r$/, '');

  if (finalLine.length > 0) {
    yield finalLine;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- split-lines.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/archive/processing/split-lines.ts back-end/service-a/src/archive/processing/split-lines.spec.ts
```

---

## Task 2: `service-a` — raw GitHub Archive event schema

**Files:**
- Create: `back-end/service-a/src/archive/processing/raw-github-event.schema.ts`
- Create: `back-end/service-a/src/archive/processing/raw-github-event.schema.spec.ts`

**Interfaces:**
- Produces: `rawGithubEventSchema` (Zod), `type RawGithubEvent` — the minimal required shape
  of one line of GH Archive NDJSON: `{ id: string; type: string; created_at: string; actor: {
  id: number; login: string }; repo: { id: number; name: string }; org?: { id: number; login:
  string }; payload: Record<string, unknown> }`. Deliberately does not validate calendar/date
  *validity* beyond ISO-8601 shape, and does not whitelist `payload`'s contents — that's
  Task 4's job; this schema only rejects lines missing the fields every downstream stage
  requires.
- Consumed by: Task 3 (`parse-and-validate.ts`), Task 4 (`transform-event.ts`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-a/src/archive/processing/raw-github-event.schema.spec.ts`:
```ts
import { rawGithubEventSchema } from './raw-github-event.schema.js';

describe('rawGithubEventSchema', () => {
  const validEvent = {
    id: '11111111111',
    type: 'PushEvent',
    created_at: '2026-08-11T00:00:00Z',
    actor: { id: 1, login: 'octocat' },
    repo: { id: 2, name: 'octocat/hello-world' },
    payload: { ref: 'refs/heads/main', commits: [{ sha: 'abc' }] },
  };

  it('should accept a valid event with no org, when org is omitted', () => {
    expect(rawGithubEventSchema.parse(validEvent)).toEqual(validEvent);
  });

  it('should accept a valid event with an org, when org is present', () => {
    const eventWithOrg = { ...validEvent, org: { id: 3, login: 'octo-org' } };

    expect(rawGithubEventSchema.parse(eventWithOrg)).toEqual(eventWithOrg);
  });

  it('should throw, when id is missing', () => {
    const { id, ...withoutId } = validEvent;

    expect(() => rawGithubEventSchema.parse(withoutId)).toThrow();
  });

  it('should throw, when type is missing', () => {
    const { type, ...withoutType } = validEvent;

    expect(() => rawGithubEventSchema.parse(withoutType)).toThrow();
  });

  it('should throw, when created_at is not an ISO datetime string', () => {
    expect(() =>
      rawGithubEventSchema.parse({ ...validEvent, created_at: 'not-a-date' }),
    ).toThrow();
  });

  it('should throw, when actor is missing', () => {
    const { actor, ...withoutActor } = validEvent;

    expect(() => rawGithubEventSchema.parse(withoutActor)).toThrow();
  });

  it('should throw, when repo.name is missing', () => {
    expect(() =>
      rawGithubEventSchema.parse({ ...validEvent, repo: { id: 2 } }),
    ).toThrow();
  });

  it('should throw, when payload is missing', () => {
    const { payload, ...withoutPayload } = validEvent;

    expect(() => rawGithubEventSchema.parse(withoutPayload)).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- raw-github-event.schema.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `raw-github-event.schema.ts`**

```ts
import { z } from 'zod';

const rawGithubActorSchema = z.object({
  id: z.number().int(),
  login: z.string().min(1),
});

const rawGithubRepositorySchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
});

export const rawGithubEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  created_at: z.iso.datetime(),
  actor: rawGithubActorSchema,
  repo: rawGithubRepositorySchema,
  org: rawGithubActorSchema.optional(),
  payload: z.record(z.string(), z.unknown()),
});

export type RawGithubEvent = z.infer<typeof rawGithubEventSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- raw-github-event.schema.spec.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/archive/processing/raw-github-event.schema.ts back-end/service-a/src/archive/processing/raw-github-event.schema.spec.ts
```

---

## Task 3: `service-a` — parse and validate NDJSON lines

**Files:**
- Create: `back-end/service-a/src/archive/processing/parse-and-validate.ts`
- Create: `back-end/service-a/src/archive/processing/parse-and-validate.spec.ts`

**Interfaces:**
- Consumes: `rawGithubEventSchema`, `type RawGithubEvent` (Task 2).
- Produces: `type OnInvalidLine = (rawLine: string, error: unknown) => void`,
  `parseAndValidate(lines: AsyncIterable<string>, onInvalidLine?: OnInvalidLine):
  AsyncGenerator<RawGithubEvent>` — for each line: `JSON.parse`, then
  `rawGithubEventSchema.safeParse`; on either failure, calls `onInvalidLine` with the line
  truncated to 200 characters and the caught error, then continues to the next line (never
  throws for one bad line, never yields for it). Counting is the caller's responsibility (via
  the callback) — this generator stays a pure, stateless step function.
- Consumed by: Task 9 (`process-archive.ts`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-a/src/archive/processing/parse-and-validate.spec.ts`:
```ts
import { parseAndValidate } from './parse-and-validate.js';

describe('parseAndValidate', () => {
  async function* fromLines(lines: string[]): AsyncGenerator<string> {
    for (const line of lines) {
      yield line;
    }
  }

  const validLine = JSON.stringify({
    id: '1',
    type: 'PushEvent',
    created_at: '2026-08-11T00:00:00Z',
    actor: { id: 1, login: 'octocat' },
    repo: { id: 2, name: 'octocat/hello-world' },
    payload: {},
  });

  it('should yield the parsed event and not call onInvalidLine, when the line is valid', async () => {
    const onInvalidLine = vi.fn();
    const results = [];

    for await (const event of parseAndValidate(fromLines([validLine]), onInvalidLine)) {
      results.push(event);
    }

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('1');
    expect(onInvalidLine).not.toHaveBeenCalled();
  });

  it('should call onInvalidLine and yield nothing, when the line is not valid JSON', async () => {
    const onInvalidLine = vi.fn();
    const results = [];

    for await (const event of parseAndValidate(fromLines(['{not valid json']), onInvalidLine)) {
      results.push(event);
    }

    expect(results).toEqual([]);
    expect(onInvalidLine).toHaveBeenCalledWith('{not valid json', expect.any(SyntaxError));
  });

  it('should call onInvalidLine and yield nothing, when the line is valid JSON but fails schema validation', async () => {
    const onInvalidLine = vi.fn();
    const invalidLine = JSON.stringify({ type: 'PushEvent' });
    const results = [];

    for await (const event of parseAndValidate(fromLines([invalidLine]), onInvalidLine)) {
      results.push(event);
    }

    expect(results).toEqual([]);
    expect(onInvalidLine).toHaveBeenCalledWith(invalidLine, expect.anything());
  });

  it('should truncate the sample passed to onInvalidLine to 200 characters, when the line is longer', async () => {
    const onInvalidLine = vi.fn();
    const longInvalidLine = `{"padding":"${'x'.repeat(300)}"`;
    const results = [];

    for await (const event of parseAndValidate(fromLines([longInvalidLine]), onInvalidLine)) {
      results.push(event);
    }

    expect(onInvalidLine).toHaveBeenCalledWith(longInvalidLine.slice(0, 200), expect.anything());
  });

  it('should yield only the valid events in order, when valid and invalid lines are mixed', async () => {
    const onInvalidLine = vi.fn();
    const results = [];

    for await (const event of parseAndValidate(
      fromLines(['not json', validLine, '{"type":"PushEvent"}']),
      onInvalidLine,
    )) {
      results.push(event);
    }

    expect(results).toHaveLength(1);
    expect(onInvalidLine).toHaveBeenCalledTimes(2);
  });

  it('should not throw, when onInvalidLine is omitted and a line is invalid', async () => {
    const results = [];

    for await (const event of parseAndValidate(fromLines(['not json']))) {
      results.push(event);
    }

    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- parse-and-validate.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `parse-and-validate.ts`**

```ts
import { rawGithubEventSchema, type RawGithubEvent } from './raw-github-event.schema.js';

const INVALID_LINE_SAMPLE_LENGTH = 200;

export type OnInvalidLine = (rawLine: string, error: unknown) => void;

export async function* parseAndValidate(
  lines: AsyncIterable<string>,
  onInvalidLine?: OnInvalidLine,
): AsyncGenerator<RawGithubEvent> {
  for await (const line of lines) {
    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(line);
    } catch (error) {
      onInvalidLine?.(line.slice(0, INVALID_LINE_SAMPLE_LENGTH), error);

      continue;
    }

    const result = rawGithubEventSchema.safeParse(parsedJson);

    if (!result.success) {
      onInvalidLine?.(line.slice(0, INVALID_LINE_SAMPLE_LENGTH), result.error);

      continue;
    }

    yield result.data;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- parse-and-validate.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/archive/processing/parse-and-validate.ts back-end/service-a/src/archive/processing/parse-and-validate.spec.ts
```

---

## Task 4: `service-a` — transform a raw event into the whitelisted document shape

**Files:**
- Create: `back-end/service-a/src/archive/processing/transform-event.ts`
- Create: `back-end/service-a/src/archive/processing/transform-event.spec.ts`

**Interfaces:**
- Consumes: `type RawGithubEvent` (Task 2), `type IGithubEventDocument` (Phase 0,
  `@task1/shared/github-archive/index`).
- Produces: `transformEvent(rawEvent: RawGithubEvent, importId: string): IGithubEventDocument`
  — pure function. Whitelists `payload` per `eventType`: `PushEvent` keeps
  `{ ref, commitCount }` (commit *count*, never the commit array itself — the exact
  unbounded-growth risk the design doc calls out); `IssuesEvent` keeps
  `{ action, issueTitle }` (title truncated to 200 characters); any other `eventType` gets an
  empty `{}` payload — a safe default that prevents unbounded document growth from event types
  this phase doesn't explicitly whitelist. `org` is included only when the raw event has one
  (never written as an explicit `undefined` field).
- Consumed by: Task 9 (`process-archive.ts`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-a/src/archive/processing/transform-event.spec.ts`:
```ts
import { transformEvent } from './transform-event.js';
import { type RawGithubEvent } from './raw-github-event.schema.js';

describe('transformEvent', () => {
  const baseEvent: RawGithubEvent = {
    id: '1',
    type: 'PushEvent',
    created_at: '2026-08-11T00:00:00Z',
    actor: { id: 1, login: 'octocat' },
    repo: { id: 2, name: 'octocat/hello-world' },
    payload: {},
  };

  it('should map eventId, eventType, actor, repo, and importId directly, when transforming any event', () => {
    const document = transformEvent(baseEvent, 'import-1');

    expect(document.eventId).toBe('1');
    expect(document.eventType).toBe('PushEvent');
    expect(document.actor).toEqual({ id: 1, login: 'octocat' });
    expect(document.repo).toEqual({ id: 2, name: 'octocat/hello-world' });
    expect(document.importId).toBe('import-1');
  });

  it('should parse createdAt into a real Date, when transforming any event', () => {
    const document = transformEvent(baseEvent, 'import-1');

    expect(document.createdAt).toBeInstanceOf(Date);
    expect(document.createdAt.toISOString()).toBe('2026-08-11T00:00:00.000Z');
  });

  it('should include org, when the raw event has one', () => {
    const document = transformEvent({ ...baseEvent, org: { id: 9, login: 'octo-org' } }, 'import-1');

    expect(document.org).toEqual({ id: 9, login: 'octo-org' });
  });

  it('should omit org entirely, when the raw event has none', () => {
    const document = transformEvent(baseEvent, 'import-1');

    expect('org' in document).toBe(false);
  });

  it('should whitelist ref and commitCount, when eventType is PushEvent', () => {
    const event: RawGithubEvent = {
      ...baseEvent,
      payload: { ref: 'refs/heads/main', commits: [{ sha: 'a' }, { sha: 'b' }] },
    };

    expect(transformEvent(event, 'import-1').payload).toEqual({
      ref: 'refs/heads/main',
      commitCount: 2,
    });
  });

  it('should default ref to an empty string and commitCount to 0, when PushEvent payload lacks them', () => {
    const event: RawGithubEvent = { ...baseEvent, payload: {} };

    expect(transformEvent(event, 'import-1').payload).toEqual({ ref: '', commitCount: 0 });
  });

  it('should whitelist action and issueTitle, when eventType is IssuesEvent', () => {
    const event: RawGithubEvent = {
      ...baseEvent,
      type: 'IssuesEvent',
      payload: { action: 'opened', issue: { title: 'Something is broken' } },
    };

    expect(transformEvent(event, 'import-1').payload).toEqual({
      action: 'opened',
      issueTitle: 'Something is broken',
    });
  });

  it('should truncate issueTitle to 200 characters, when the title is longer', () => {
    const longTitle = 'x'.repeat(250);
    const event: RawGithubEvent = {
      ...baseEvent,
      type: 'IssuesEvent',
      payload: { action: 'opened', issue: { title: longTitle } },
    };

    expect(transformEvent(event, 'import-1').payload.issueTitle).toBe(longTitle.slice(0, 200));
  });

  it('should default action to an empty string and issueTitle to an empty string, when IssuesEvent payload lacks them', () => {
    const event: RawGithubEvent = { ...baseEvent, type: 'IssuesEvent', payload: {} };

    expect(transformEvent(event, 'import-1').payload).toEqual({ action: '', issueTitle: '' });
  });

  it('should produce an empty payload, when eventType is not explicitly whitelisted', () => {
    const event: RawGithubEvent = {
      ...baseEvent,
      type: 'WatchEvent',
      payload: { action: 'started' },
    };

    expect(transformEvent(event, 'import-1').payload).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- transform-event.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `transform-event.ts`**

```ts
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';

import { type RawGithubEvent } from './raw-github-event.schema.js';

const ISSUE_TITLE_MAX_LENGTH = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function buildPayload(rawEvent: RawGithubEvent): Record<string, unknown> {
  switch (rawEvent.type) {
    case 'PushEvent': {
      const commits = rawEvent.payload.commits;
      const ref = rawEvent.payload.ref;

      return {
        ref: typeof ref === 'string' ? ref : '',
        commitCount: Array.isArray(commits) ? commits.length : 0,
      };
    }

    case 'IssuesEvent': {
      const action = rawEvent.payload.action;
      const issue = rawEvent.payload.issue;
      const issueTitle = isRecord(issue) && typeof issue.title === 'string' ? issue.title : '';

      return {
        action: typeof action === 'string' ? action : '',
        issueTitle: issueTitle.slice(0, ISSUE_TITLE_MAX_LENGTH),
      };
    }

    default:
      return {};
  }
}

export function transformEvent(rawEvent: RawGithubEvent, importId: string): IGithubEventDocument {
  return {
    eventId: rawEvent.id,
    eventType: rawEvent.type,
    createdAt: new Date(rawEvent.created_at),
    actor: rawEvent.actor,
    repo: rawEvent.repo,
    importId,
    payload: buildPayload(rawEvent),
    ...(rawEvent.org === undefined ? {} : { org: rawEvent.org }),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- transform-event.spec.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/archive/processing/transform-event.ts back-end/service-a/src/archive/processing/transform-event.spec.ts
```

---

## Task 5: `service-a` — batching generator

**Files:**
- Create: `back-end/service-a/src/archive/processing/batch-events.ts`
- Create: `back-end/service-a/src/archive/processing/batch-events.spec.ts`

**Interfaces:**
- Produces: `batchEvents<T>(events: AsyncIterable<T>, batchSize: number): AsyncGenerator<T[]>`
  — yields arrays of up to `batchSize` items; the final, possibly-shorter batch is still
  yielded; yields nothing for an empty input. Generic (not tied to `IGithubEventDocument`) so
  Task 9 can reuse it unchanged if a later phase ever batches a different shape.
- Consumed by: Task 9 (`process-archive.ts`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-a/src/archive/processing/batch-events.spec.ts`:
```ts
import { batchEvents } from './batch-events.js';

describe('batchEvents', () => {
  async function* fromArray<T>(items: T[]): AsyncGenerator<T> {
    for (const item of items) {
      yield item;
    }
  }

  async function collect<T>(source: AsyncGenerator<T[]>): Promise<T[][]> {
    const batches: T[][] = [];

    for await (const batch of source) {
      batches.push(batch);
    }

    return batches;
  }

  it('should yield evenly-sized batches, when the input count is an exact multiple of batchSize', async () => {
    const batches = await collect(batchEvents(fromArray([1, 2, 3, 4]), 2));

    expect(batches).toEqual([[1, 2], [3, 4]]);
  });

  it('should yield a shorter final batch, when the input count is not a multiple of batchSize', async () => {
    const batches = await collect(batchEvents(fromArray([1, 2, 3, 4, 5]), 2));

    expect(batches).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('should yield one batch containing everything, when the input is shorter than batchSize', async () => {
    const batches = await collect(batchEvents(fromArray([1, 2]), 5));

    expect(batches).toEqual([[1, 2]]);
  });

  it('should yield nothing, when the input is empty', async () => {
    const batches = await collect(batchEvents(fromArray<number>([]), 5));

    expect(batches).toEqual([]);
  });

  it('should yield one batch per item, when batchSize is 1', async () => {
    const batches = await collect(batchEvents(fromArray([1, 2, 3]), 1));

    expect(batches).toEqual([[1], [2], [3]]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- batch-events.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `batch-events.ts`**

```ts
export async function* batchEvents<T>(
  events: AsyncIterable<T>,
  batchSize: number,
): AsyncGenerator<T[]> {
  let currentBatch: T[] = [];

  for await (const event of events) {
    currentBatch.push(event);

    if (currentBatch.length >= batchSize) {
      yield currentBatch;
      currentBatch = [];
    }
  }

  if (currentBatch.length > 0) {
    yield currentBatch;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- batch-events.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/archive/processing/batch-events.ts back-end/service-a/src/archive/processing/batch-events.spec.ts
```

---

## Task 6: `service-a` — batched bulk insert with duplicate/error counting

**Files:**
- Create: `back-end/service-a/src/archive/processing/insert-batch.ts`
- Create: `back-end/service-a/src/archive/processing/insert-batch.spec.ts`

**Interfaces:**
- Consumes: `type IGithubEventDocument` (Phase 0), `Collection`, `MongoBulkWriteError` (from
  `mongodb`, already a `service-a` dependency).
- Produces: `IInsertBatchResult { insertedCount: number; duplicateCount: number; errorCount:
  number }`, `insertBatch(collection: Collection<IGithubEventDocument>, batch:
  readonly IGithubEventDocument[]): Promise<IInsertBatchResult>` — unordered bulk insert;
  catches `MongoBulkWriteError` (see Global Constraints Finding 2/3 for why this uses a
  `name`-based check, not `instanceof`) and splits its `writeErrors` into duplicate-key
  (`code === 11000`) vs. other-error counts; any other thrown error propagates unchanged (not
  this function's job to wrap it — Task 9 does that at the orchestration level).
- Consumed by: Task 9 (`process-archive.ts`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-a/src/archive/processing/insert-batch.spec.ts`:
```ts
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection, type MongoBulkWriteError } from 'mongodb';

import { insertBatch } from './insert-batch.js';

describe('insertBatch', () => {
  function buildDocument(eventId: string): IGithubEventDocument {
    return {
      eventId,
      eventType: 'PushEvent',
      createdAt: new Date('2026-08-11T00:00:00Z'),
      actor: { id: 1, login: 'octocat' },
      repo: { id: 2, name: 'octocat/hello-world' },
      importId: 'import-1',
      payload: {},
    };
  }

  function buildBulkWriteError(insertedCount: number, codes: number[]): MongoBulkWriteError {
    return Object.assign(new Error('bulk write failed'), {
      name: 'MongoBulkWriteError',
      insertedCount,
      writeErrors: codes.map((code) => ({ code })),
    }) as unknown as MongoBulkWriteError;
  }

  it('should return zero counts and not call insertMany, when the batch is empty', async () => {
    const insertMany = vi.fn();
    const collection = { insertMany } as unknown as Collection<IGithubEventDocument>;

    const result = await insertBatch(collection, []);

    expect(result).toEqual({ insertedCount: 0, duplicateCount: 0, errorCount: 0 });
    expect(insertMany).not.toHaveBeenCalled();
  });

  it('should return the full insertedCount and zero errors, when every document inserts successfully', async () => {
    const batch = [buildDocument('e1'), buildDocument('e2')];
    const insertMany = vi.fn().mockResolvedValue({ insertedCount: 2 });
    const collection = { insertMany } as unknown as Collection<IGithubEventDocument>;

    const result = await insertBatch(collection, batch);

    expect(result).toEqual({ insertedCount: 2, duplicateCount: 0, errorCount: 0 });
    expect(insertMany).toHaveBeenCalledWith(batch, { ordered: false });
  });

  it('should count duplicate-key write errors separately from other errors, when the batch has both', async () => {
    const batch = [buildDocument('e1'), buildDocument('e2'), buildDocument('e3')];
    const bulkWriteError = buildBulkWriteError(1, [11000, 11000, 121]);
    const insertMany = vi.fn().mockRejectedValue(bulkWriteError);
    const collection = { insertMany } as unknown as Collection<IGithubEventDocument>;

    const result = await insertBatch(collection, batch);

    expect(result).toEqual({ insertedCount: 1, duplicateCount: 2, errorCount: 1 });
  });

  it('should count a single write error, when writeErrors arrives as one object instead of an array', async () => {
    const batch = [buildDocument('e1')];
    const bulkWriteError = Object.assign(new Error('bulk write failed'), {
      name: 'MongoBulkWriteError',
      insertedCount: 0,
      writeErrors: { code: 11000 },
    }) as unknown as MongoBulkWriteError;
    const insertMany = vi.fn().mockRejectedValue(bulkWriteError);
    const collection = { insertMany } as unknown as Collection<IGithubEventDocument>;

    const result = await insertBatch(collection, batch);

    expect(result).toEqual({ insertedCount: 0, duplicateCount: 1, errorCount: 0 });
  });

  it('should rethrow, when insertMany rejects with an error that is not a MongoBulkWriteError', async () => {
    const batch = [buildDocument('e1')];
    const connectionError = new Error('connection closed');
    const insertMany = vi.fn().mockRejectedValue(connectionError);
    const collection = { insertMany } as unknown as Collection<IGithubEventDocument>;

    await expect(insertBatch(collection, batch)).rejects.toThrow('connection closed');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- insert-batch.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `insert-batch.ts`**

```ts
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection, type MongoBulkWriteError } from 'mongodb';

const DUPLICATE_KEY_ERROR_CODE = 11000;

export interface IInsertBatchResult {
  insertedCount: number;
  duplicateCount: number;
  errorCount: number;
}

function isMongoBulkWriteError(error: unknown): error is MongoBulkWriteError {
  return error instanceof Error && error.name === 'MongoBulkWriteError';
}

export async function insertBatch(
  collection: Collection<IGithubEventDocument>,
  batch: readonly IGithubEventDocument[],
): Promise<IInsertBatchResult> {
  if (batch.length === 0) {
    return { insertedCount: 0, duplicateCount: 0, errorCount: 0 };
  }

  try {
    const result = await collection.insertMany(batch, { ordered: false });

    return { insertedCount: result.insertedCount, duplicateCount: 0, errorCount: 0 };
  } catch (error) {
    if (!isMongoBulkWriteError(error)) {
      throw error;
    }

    const writeErrors = Array.isArray(error.writeErrors) ? error.writeErrors : [error.writeErrors];
    const duplicateCount = writeErrors.filter(
      (writeError) => writeError.code === DUPLICATE_KEY_ERROR_CODE,
    ).length;

    return {
      insertedCount: error.insertedCount,
      duplicateCount,
      errorCount: writeErrors.length - duplicateCount,
    };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- insert-batch.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/archive/processing/insert-batch.ts back-end/service-a/src/archive/processing/insert-batch.spec.ts
```

---

## Task 7: `service-a` — events collection unique index

**Files:**
- Create: `back-end/service-a/src/archive/processing/ensure-event-indexes.ts`
- Create: `back-end/service-a/src/archive/processing/ensure-event-indexes.spec.ts`

**Interfaces:**
- Produces: `ensureEventIndexes(collection: Collection<IGithubEventDocument>): Promise<void>`
  — idempotently creates the `{ eventId: 1 }` unique index (see Global Constraints for why
  only this one index, not the others the design doc documents).
- Consumed by: Phase 5 (called once at startup, once service-a has a real `Collection` and an
  `OnModuleInit` hook to call it from — nothing in this phase calls it yet, matching Phase 1
  Task 6's "registered now, consumed later" pattern for `archiveConfig`).

- [ ] **Step 1: Write the failing test**

`back-end/service-a/src/archive/processing/ensure-event-indexes.spec.ts`:
```ts
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection } from 'mongodb';

import { ensureEventIndexes } from './ensure-event-indexes.js';

describe('ensureEventIndexes', () => {
  it('should create a unique index on eventId, when called', async () => {
    const createIndex = vi.fn().mockResolvedValue('eventId_1');
    const collection = { createIndex } as unknown as Collection<IGithubEventDocument>;

    await ensureEventIndexes(collection);

    expect(createIndex).toHaveBeenCalledWith({ eventId: 1 }, { unique: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- ensure-event-indexes.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ensure-event-indexes.ts`**

```ts
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection } from 'mongodb';

export async function ensureEventIndexes(
  collection: Collection<IGithubEventDocument>,
): Promise<void> {
  await collection.createIndex({ eventId: 1 }, { unique: true });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- ensure-event-indexes.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/archive/processing/ensure-event-indexes.ts back-end/service-a/src/archive/processing/ensure-event-indexes.spec.ts
```

---

## Task 8: `service-a` — archive processing error type

**Files:**
- Create: `back-end/service-a/src/archive/processing/errors.ts`

**Interfaces:**
- Consumes: `AppError`, `ErrorCategory` from `@task1/shared/errors/index`.
- Produces: `ArchiveProcessingError extends AppError` (constructor:
  `(message: string, importId: string, filePath: string, cause?: Error)`, category
  `EXTERNAL`, code `'ARCHIVE_PROCESSING_FAILED'`, `params: { importId, filePath }`) — wraps
  any failure from reading/decompressing the archive file or from a non-`MongoBulkWriteError`
  Mongo failure, so nothing in this module ever throws a raw `Error` or a raw driver error.
- Consumed by: Task 9 (`process-archive.ts`).

- [ ] **Step 1: Create the error class**

`back-end/service-a/src/archive/processing/errors.ts`:
```ts
import { AppError, ErrorCategory } from '@task1/shared/errors/index';

export class ArchiveProcessingError extends AppError {
  public constructor(message: string, importId: string, filePath: string, cause?: Error) {
    super(
      message,
      ArchiveProcessingError.buildOptions({
        code: 'ARCHIVE_PROCESSING_FAILED',
        category: ErrorCategory.EXTERNAL,
        params: { importId, filePath },
        ...(cause === undefined ? {} : { cause }),
      }),
    );
  }
}
```

- [ ] **Step 2: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 3: Stage the file**

```bash
git add back-end/service-a/src/archive/processing/errors.ts
```

(No test run in this task — matches Phase 1's convention for its own `errors.ts`; this
class's throw-behavior is exercised by Task 9's failure-path tests.)

---

## Task 9: `service-a` — processing pipeline orchestration

**Files:**
- Create: `back-end/service-a/src/archive/processing/process-archive.ts`
- Create: `back-end/service-a/src/archive/processing/process-archive.spec.ts`

**Interfaces:**
- Consumes: `splitLines` (Task 1), `parseAndValidate`/`type OnInvalidLine` (Task 3),
  `transformEvent` (Task 4), `batchEvents` (Task 5), `insertBatch` (Task 6),
  `ArchiveProcessingError` (Task 8).
- Produces: `type ImportResult = { eventsProcessed: number; validEvents: number; invalidEvents:
  number; duplicateEvents: number; errorCount: number }`, `IProcessArchiveOptions {
  collection: Collection<IGithubEventDocument>; batchSize: number }`,
  `processArchive(filePath: string, importId: string, options: IProcessArchiveOptions,
  onInvalidLine?: OnInvalidLine): Promise<ImportResult>`.
- Consumed by: Phase 3 (upload flow calls this directly, no separate upload-specific
  processing code — per the design doc), Phase 5 (the real import orchestration wraps this
  with `import.started`/`.completed`/`.failed` emission and builds `options` from
  `mongodbConfig().batchSize` and a real `MONGO_CLIENT`-derived `Collection`).

This is the orchestration function per the design doc: gunzip → split → parse/validate →
transform → batch → insert, accumulating counters, never an array of events. `eventsProcessed`
is derived (`invalidEvents + validEvents + duplicateEvents + errorCount`) rather than tracked
as a separate counter — every line ends up in exactly one of those four buckets, so a fifth
counter would be redundant, untested-if-wrong state. Any failure anywhere in the pipeline
(corrupt/missing file, a non-partial Mongo failure) is caught once, at the top, and re-thrown
as `ArchiveProcessingError` — never a raw `Error`, never a raw driver error escaping this
module.

- [ ] **Step 1: Write the failing tests**

`back-end/service-a/src/archive/processing/process-archive.spec.ts`:
```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection, type MongoBulkWriteError } from 'mongodb';

import { ArchiveProcessingError } from './errors.js';
import { processArchive } from './process-archive.js';

describe('processArchive', () => {
  let storageDirectory: string;

  beforeEach(() => {
    storageDirectory = mkdtempSync(join(tmpdir(), 'process-archive-spec-'));
  });

  afterEach(() => {
    rmSync(storageDirectory, { recursive: true, force: true });
  });

  function buildRawLine(eventId: string, type = 'PushEvent'): string {
    return JSON.stringify({
      id: eventId,
      type,
      created_at: '2026-08-11T00:00:00Z',
      actor: { id: 1, login: 'octocat' },
      repo: { id: 2, name: 'octocat/hello-world' },
      payload: {},
    });
  }

  function writeGzippedArchive(fileName: string, lines: string[]): string {
    const filePath = join(storageDirectory, fileName);
    const gzipped = gzipSync(Buffer.from(`${lines.join('\n')}\n`));

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    writeFileSync(filePath, gzipped);

    return filePath;
  }

  it('should return correct counters and prove batching happened, when the archive has valid, invalid, and duplicate lines', async () => {
    const filePath = writeGzippedArchive('archive.json.gz', [
      buildRawLine('e1'),
      buildRawLine('e2', 'IssuesEvent'),
      '{not valid json',
      buildRawLine('e3'),
      JSON.stringify({ type: 'PushEvent' }),
      buildRawLine('e4', 'WatchEvent'),
      buildRawLine('e5'),
    ]);
    const bulkWriteError = Object.assign(new Error('bulk write failed'), {
      name: 'MongoBulkWriteError',
      insertedCount: 0,
      writeErrors: [{ code: 11000 }],
    }) as unknown as MongoBulkWriteError;
    const insertMany = vi
      .fn()
      .mockResolvedValueOnce({ insertedCount: 2 })
      .mockResolvedValueOnce({ insertedCount: 2 })
      .mockRejectedValueOnce(bulkWriteError);
    const collection = { insertMany } as unknown as Collection<IGithubEventDocument>;
    const onInvalidLine = vi.fn();

    const result = await processArchive(
      filePath,
      'import-1',
      { collection, batchSize: 2 },
      onInvalidLine,
    );

    expect(result).toEqual({
      eventsProcessed: 7,
      validEvents: 4,
      invalidEvents: 2,
      duplicateEvents: 1,
      errorCount: 0,
    });
    expect(insertMany).toHaveBeenCalledTimes(3);
    expect(onInvalidLine).toHaveBeenCalledTimes(2);
  });

  it('should throw ArchiveProcessingError, when the file does not exist', async () => {
    const missingPath = join(storageDirectory, 'does-not-exist.json.gz');
    const collection = { insertMany: vi.fn() } as unknown as Collection<IGithubEventDocument>;

    await expect(
      processArchive(missingPath, 'import-1', { collection, batchSize: 500 }),
    ).rejects.toThrow(ArchiveProcessingError);
    expect(collection.insertMany).not.toHaveBeenCalled();
  });

  it('should throw ArchiveProcessingError, when the file is not valid gzip content', async () => {
    const filePath = join(storageDirectory, 'not-gzip.json.gz');

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    writeFileSync(filePath, 'this is not gzip data');
    const collection = { insertMany: vi.fn() } as unknown as Collection<IGithubEventDocument>;

    await expect(
      processArchive(filePath, 'import-1', { collection, batchSize: 500 }),
    ).rejects.toThrow(ArchiveProcessingError);
    expect(collection.insertMany).not.toHaveBeenCalled();
  });

  it('should throw ArchiveProcessingError, when a batch insert fails with a non-bulk-write error', async () => {
    const filePath = writeGzippedArchive('archive.json.gz', [buildRawLine('e1')]);
    const insertMany = vi.fn().mockRejectedValue(new Error('connection closed'));
    const collection = { insertMany } as unknown as Collection<IGithubEventDocument>;

    await expect(
      processArchive(filePath, 'import-1', { collection, batchSize: 500 }),
    ).rejects.toThrow(ArchiveProcessingError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- process-archive.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `process-archive.ts`**

```ts
import { createReadStream } from 'node:fs';
import { compose } from 'node:stream';
import { createGunzip } from 'node:zlib';

import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection } from 'mongodb';

import { batchEvents } from './batch-events.js';
import { ArchiveProcessingError } from './errors.js';
import { insertBatch } from './insert-batch.js';
import { parseAndValidate, type OnInvalidLine } from './parse-and-validate.js';
import { splitLines } from './split-lines.js';
import { transformEvent } from './transform-event.js';
import { type RawGithubEvent } from './raw-github-event.schema.js';

export interface IProcessArchiveOptions {
  collection: Collection<IGithubEventDocument>;
  batchSize: number;
}

export type ImportResult = {
  eventsProcessed: number;
  validEvents: number;
  invalidEvents: number;
  duplicateEvents: number;
  errorCount: number;
};

async function* transformEvents(
  rawEvents: AsyncIterable<RawGithubEvent>,
  importId: string,
): AsyncGenerator<IGithubEventDocument> {
  for await (const rawEvent of rawEvents) {
    yield transformEvent(rawEvent, importId);
  }
}

export async function processArchive(
  filePath: string,
  importId: string,
  options: IProcessArchiveOptions,
  onInvalidLine?: OnInvalidLine,
): Promise<ImportResult> {
  let invalidEvents = 0;
  let validEvents = 0;
  let duplicateEvents = 0;
  let errorCount = 0;

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- filePath comes from the download/upload flow's validated storage path, never raw external input.
    const archiveStream = compose(createReadStream(filePath), createGunzip());
    const lines = splitLines(archiveStream);
    const rawEvents = parseAndValidate(lines, (rawLine, error) => {
      invalidEvents += 1;
      onInvalidLine?.(rawLine, error);
    });
    const documents = transformEvents(rawEvents, importId);
    const batches = batchEvents(documents, options.batchSize);

    for await (const batch of batches) {
      const result = await insertBatch(options.collection, batch);

      validEvents += result.insertedCount;
      duplicateEvents += result.duplicateCount;
      errorCount += result.errorCount;
    }
  } catch (error) {
    const cause = error instanceof Error ? error : undefined;

    throw new ArchiveProcessingError(
      `Archive processing failed: ${error instanceof Error ? error.message : String(error)}`,
      importId,
      filePath,
      cause,
    );
  }

  return {
    eventsProcessed: invalidEvents + validEvents + duplicateEvents + errorCount,
    validEvents,
    invalidEvents,
    duplicateEvents,
    errorCount,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- process-archive.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full `service-a` test suite, lint, and build**

Run: `pnpm --filter service-a test && pnpm --filter service-a lint && pnpm --filter service-a build`
Expected: all three PASS/succeed — this is the first point every file from Tasks 1-9 is
compiled together as one program.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/archive/processing/process-archive.ts back-end/service-a/src/archive/processing/process-archive.spec.ts
```

---

## Task 10: End-to-end verification against a real MongoDB

**Files:** none — this task only runs commands and reads output. Every task above is tested
against a fully mocked `Collection` (no live database, per this repo's testing convention) —
this is the "does duplicate detection actually work against a real unique index, and does a
real driver error really carry `name === 'MongoBulkWriteError'`" checkpoint those tests can't
cover (Global Constraints Findings 2/3 are the whole reason this checkpoint exists).

- [ ] **Step 1: Start the infrastructure containers**

Run: `pnpm docker:up`
Expected: `rabbitmq`, `mongodb`, `redis` (and the other services, already running from earlier
phases) reach a healthy state.

- [ ] **Step 2: Build `service-a`**

Run: `pnpm --filter service-a build`
Expected: succeeds.

- [ ] **Step 3: Run the real pipeline against the real MongoDB from a small ad-hoc script**

```bash
cd back-end/service-a
node --input-type=module -e "
import { MongoClient } from 'mongodb';
import { gzipSync } from 'node:zlib';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureEventIndexes } from './dist/archive/processing/ensure-event-indexes.js';
import { processArchive } from './dist/archive/processing/process-archive.js';

const client = new MongoClient('mongodb://localhost:27017/service_a_phase2_smoke');
await client.connect();
const collection = client.db().collection('events');
await ensureEventIndexes(collection);

function buildLine(eventId) {
  return JSON.stringify({
    id: eventId,
    type: 'PushEvent',
    created_at: '2026-08-11T00:00:00Z',
    actor: { id: 1, login: 'octocat' },
    repo: { id: 2, name: 'octocat/hello-world' },
    payload: { ref: 'refs/heads/main', commits: [{ sha: 'a' }] },
  });
}

const directory = mkdtempSync(join(tmpdir(), 'phase2-smoke-'));
const filePath = join(directory, 'archive.json.gz');
writeFileSync(filePath, gzipSync(Buffer.from([buildLine('smoke-1'), buildLine('smoke-2')].join('\n') + '\n')));

const firstRun = await processArchive(filePath, 'import-smoke-1', { collection, batchSize: 500 });
console.log('First run:', firstRun);

const secondRun = await processArchive(filePath, 'import-smoke-2', { collection, batchSize: 500 });
console.log('Second run (same eventIds again):', secondRun);

await client.close();
"
```

Expected: `First run:` logs `{ eventsProcessed: 2, validEvents: 2, invalidEvents: 0,
duplicateEvents: 0, errorCount: 0 }`. `Second run` (identical `eventId`s re-processed) logs
`{ eventsProcessed: 2, validEvents: 0, invalidEvents: 0, duplicateEvents: 2, errorCount: 0 }`
— this specifically proves two things Tasks 6-9's mocked tests could only assert against a
fake: (1) the `{ eventId: 1 }` unique index really causes a real `E11000` on the second run,
and (2) `insertBatch`'s `error.name === 'MongoBulkWriteError'` check really matches what the
live driver throws (Global Constraints Finding 2).

- [ ] **Step 4: Clean up the smoke-test database**

```bash
docker compose exec mongodb mongosh --quiet --eval "db.getSiblingDB('service_a_phase2_smoke').dropDatabase()"
```

Expected: `{ ok: 1, ... }` — removes the smoke-test database so it doesn't linger as
unexplained state alongside the real `service_a` database.

---

## Self-Review

**Spec coverage:** the design doc's entire "Service-a: processing pipeline (Phase 2, shared by
download + upload)" section maps to Tasks 1-9 (gunzip→split→parse/validate→transform→batch→
insert, exactly the pipeline's stated stages, each its own step function); the `events`
collection's unique-index requirement from "Data model" maps to Task 7; the design's explicit
"never a full-file buffer, never a full-file array of events" constraint is satisfied by every
stage being an async generator operating on one line/one batch at a time, verified by Task 9's
pipeline test asserting `insertMany` was called 3 times for a 7-line file with `batchSize: 2`
(proves batching, not one giant insert — the exact assertion the roadmap's own "Testable
deliverable" for this phase calls for). The roadmap's stated interfaces
(`processArchive(filePath, importId): Promise<ImportResult>`) are produced with two additional
parameters (`options`, `onInvalidLine`) needed for this phase to stay DI-free and directly
testable, mirroring exactly how Phase 1's `downloadArchive` added an `options`
parameter beyond the roadmap's own two-argument sketch for the same reason.

**Placeholder scan:** no TBD/TODO; every step shows complete, verified file contents or an
exact runnable command with expected output.

**Type/name consistency:** `RawGithubEvent` (Task 2) is imported unchanged by Tasks 3, 4, and
9. `IGithubEventDocument` (Phase 0, `@task1/shared/github-archive/index`) is the exact
`transformEvent` (Task 4) return type, `insertBatch`/`ensureEventIndexes`'s `Collection<...>`
generic (Tasks 6-7), and `process-archive.ts`'s `IProcessArchiveOptions.collection` element
type. `OnInvalidLine` (Task 3) is reused unchanged by Task 9's `processArchive` signature.
`IInsertBatchResult`'s three fields (`insertedCount`, `duplicateCount`, `errorCount`) are read
by name in Task 9's accumulation loop exactly as Task 6 defines them. `ImportResult`'s five
fields match the design doc's `ImportCompletedEvent` shape field-for-field
(`eventsProcessed`, `validEvents`, `invalidEvents`, `duplicateEvents`, `errorCount`), which is
what lets Phase 5 spread this return value directly into that event's payload without any
renaming.
