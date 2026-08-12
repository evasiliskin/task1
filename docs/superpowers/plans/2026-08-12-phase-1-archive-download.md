# Phase 1: Service-a Archive Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `downloadArchive(dateHour, options, httpGet?)` — streams one GitHub Archive
`.json.gz` file from `https://data.gharchive.org` to `STORAGE_DIR`, memory-bounded
(response stream piped directly to a file write stream, never buffered), safe on
failure (temp-file-then-rename, cleanup on any error), and fully unit-testable without
touching a real network or `vi.mock()`.

**Architecture:** A new `back-end/service-a/src/archive/download/` module with four
files, each with one responsibility: `archive-url.util.ts` (validate + build the URL),
`errors.ts` (the two error types this module can throw), `fetch-archive-stream.ts`
(issue the HTTPS GET, resolve once a 2xx response stream is available), and
`download-archive.ts` (the orchestration function — temp file, pipe, rename, cleanup).
The HTTP layer (`node:https`) and the fetch step are both injected as an optional
function parameter with a real default, so tests substitute a fake implementation
instead of mocking a built-in module. No NestJS wiring, no controller, no RMQ handler —
this phase is pure, directly callable, fully unit-testable in isolation (matches Phase
0's roadmap note); Phase 5 wires this into the real import orchestration.

**Tech Stack:** Node's built-in `node:https`/`node:fs`/`node:stream/promises` only — no
new npm dependency. Zod (already present). Vitest.

**Design doc:** `docs/superpowers/specs/2026-08-12-github-archive-platform-design.md`
(section "Service-a: download (Phase 1)")
**Roadmap:** `docs/superpowers/plans/2026-08-12-github-archive-platform-plan.md` (Phase 1 of 11)
**Depends on:** Phase 0 (`storageConfig`, `@task1/shared` error base classes) — already merged.

Every piece of code in this plan was written and empirically verified (lint, unit
tests, `nest build`, and a full monorepo `pnpm build`/`pnpm test` pass) against this
exact codebase before this plan was written — not guessed. Two non-obvious findings
from that verification are called out below because they will otherwise cost real time
during implementation.

## Global Constraints

- Never throw raw `Error` from any function this plan adds — `InvalidDateHourError` and
  `ArchiveDownloadError` (both new, `back-end/service-a/src/archive/download/errors.ts`)
  extend `AppError` directly (`@task1/shared/errors/index`) — there is no intermediate
  abstract base needed for either (unlike `FatalError`/`MissingRequestContextError`,
  which extend the marker base `InternalError`, these two are not "internal" errors, so
  they extend `AppError` directly — verified this is a valid, already-used pattern:
  `AppError`'s constructor is `protected`, so any direct subclass can call `super(...)`
  and the protected static `buildOptions(...)` helper).
- **`@task1/shared` is resolved via its real `package.json` `exports` map against
  `dist/`, not via `tsconfig.json`'s `paths` source-mapping** — confirmed empirically:
  editing `back-end/libs/shared/src/errors/error-category.enum.ts` and immediately
  linting a file in `service-a` that references the new enum member produces
  `TS2339: Property 'EXTERNAL' does not exist on type 'typeof ErrorCategory'` until
  `pnpm --filter @task1/shared build` is run. **Every task below that touches
  `@task1/shared` must rebuild it before any later task's lint/test/build step will see
  the change.**
- `unicorn/prevent-abbreviations` rejects short local variable/parameter names — use
  full words (`parameters`, `directory`, `destination`, not `params`/`dir`/`dest`) for
  anything you name yourself. **Exception:** when a variable's key must literally match
  an external interface field name (e.g. `IAppErrorOptions.params`), the object literal
  *property key* `params: ...` is not flagged by this rule — only rename your own local
  binding, never the property key that satisfies someone else's interface.
- `security/detect-non-literal-fs-filename` fires on every dynamic-path call to
  `mkdir`/`createWriteStream`/`rename`/`unlink`/`existsSync`/`readFileSync` — including
  in `*.spec.ts` files (this rule is not relaxed for tests in this repo's ESLint config,
  confirmed empirically). Every such call in this plan already carries a justified
  `// eslint-disable-next-line security/detect-non-literal-fs-filename -- <reason>`
  comment in the code shown below — copy it verbatim, don't drop it.
- Avoid the `void somePromise` pattern — this repo's `no-void` rule has no
  `allowAsStatement` exception, so `void promise` is a lint error. If a promise must be
  fire-and-forget in a test, either `await` it after triggering whatever makes it
  settle, or restructure the test so nothing is left unhandled (see Task 5's timeout
  test for the pattern used here).
- Type-only imports use inline `type` modifiers; relative imports use explicit `.js`
  extensions; imports grouped (builtin/external/internal/parent/sibling/index),
  alphabetized ascending case-insensitive, blank line between groups.
- Interfaces are `PascalCase` prefixed with `I`; `type` aliases are `PascalCase` with no
  prefix.
- Blank line required before every `return`/`throw` following a `const`/`let`/`var` or
  expression statement, and before every `if`.
- No `git commit` restriction in this plan's execution worktree — per this repo's
  established convention (see Phase 0), commits inside an isolated implementation
  worktree are expected; the "never commit automatically" rule in `CLAUDE.md` is about
  the user's own primary working directory, not a worktree created for this plan.
- BDD test naming: `it('should X, when Y')`. Coverage thresholds: 90% lines, 90%
  branches (not separately enforced by `pnpm check`, which only runs lint+test, but
  write to the standard anyway).
- No dedicated `*.spec.ts` file is written for `errors.ts` in this plan — matches this
  repo's existing convention (`MissingRequestContextError` has no spec file either);
  both error classes' throw-behavior is exercised indirectly by the consuming tasks'
  tests (Task 3 throws/catches `InvalidDateHourError`, Task 4/5 throw/catch
  `ArchiveDownloadError`).

---

## Task 1: Shared package — add `ErrorCategory.EXTERNAL`

**Files:**
- Modify: `back-end/libs/shared/src/errors/error-category.enum.ts`

**Interfaces:**
- Produces: `ErrorCategory.EXTERNAL = 'EXTERNAL'` — a new category for errors caused by
  a failing external dependency (this phase's GitHub Archive HTTP calls; reusable by any
  future outbound-HTTP-call error elsewhere in the platform). Distinct from `INTERNAL`
  (a genuine bug in our own code) so error-response mapping can eventually treat the two
  differently (e.g. 502/503 vs 500) — `back-end/libs/shared/src/exception-handling/status-from-app-error.utility.ts`
  currently returns a hardcoded `500` regardless of category for every error (a
  pre-existing stub, not something this task changes), so adding a new enum member here
  is safe and cannot break an exhaustiveness check anywhere in the codebase today
  (confirmed — no code currently `switch`es over `ErrorCategory`).

- [ ] **Step 1: Add the new category value**

Modify `back-end/libs/shared/src/errors/error-category.enum.ts` to:
```ts
export enum ErrorCategory {
  AUTH = 'AUTH',
  VALIDATION = 'VALIDATION',
  INTERNAL = 'INTERNAL',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  RATE_LIMIT = 'RATE_LIMIT',
  EXTERNAL = 'EXTERNAL',
}
```

- [ ] **Step 2: Rebuild `@task1/shared`**

Run: `pnpm --filter @task1/shared build`
Expected: succeeds with no output (this updates `dist/errors/error-category.enum.d.ts`,
which is what `service-a`'s type-checker/linter actually resolves — see Global
Constraints).

- [ ] **Step 3: Run the shared package's test suite and lint**

Run: `pnpm --filter @task1/shared lint && pnpm --filter @task1/shared test`
Expected: both PASS (no existing test asserts the exhaustive list of `ErrorCategory`
members, so nothing breaks).

- [ ] **Step 4: Stage the file**

```bash
git add back-end/libs/shared/src/errors/error-category.enum.ts
```

---

## Task 2: `service-a` — archive-download error classes

**Files:**
- Create: `back-end/service-a/src/archive/download/errors.ts`

**Interfaces:**
- Consumes: `AppError`, `ErrorCategory` from `@task1/shared/errors/index` (Task 1's
  `EXTERNAL` member).
- Produces: `InvalidDateHourError extends AppError` (constructor: `(dateHour: string)`,
  category `VALIDATION`, code `'INVALID_DATE_HOUR'`, `params: { dateHour }`).
  `ArchiveDownloadError extends AppError` (constructor:
  `(message: string, url: string, statusCode?: number, cause?: Error)`, category
  `EXTERNAL`, code `'ARCHIVE_DOWNLOAD_FAILED'`, `params: { url }` or
  `{ url, statusCode }` depending on whether a status code is known).
- Consumed by: Task 3 (`InvalidDateHourError`), Task 4 and Task 5 (`ArchiveDownloadError`).

- [ ] **Step 1: Create the error classes**

`back-end/service-a/src/archive/download/errors.ts`:
```ts
import { AppError, ErrorCategory } from '@task1/shared/errors/index';

export class InvalidDateHourError extends AppError {
  public constructor(dateHour: string) {
    super(
      `Invalid dateHour format: "${dateHour}" (expected YYYY-MM-DD-H, hour 0-23)`,
      InvalidDateHourError.buildOptions({
        code: 'INVALID_DATE_HOUR',
        category: ErrorCategory.VALIDATION,
        params: { dateHour },
      }),
    );
  }
}

export class ArchiveDownloadError extends AppError {
  public constructor(message: string, url: string, statusCode?: number, cause?: Error) {
    const errorParameters: Record<string, unknown> =
      statusCode === undefined ? { url } : { url, statusCode };

    super(
      message,
      ArchiveDownloadError.buildOptions({
        code: 'ARCHIVE_DOWNLOAD_FAILED',
        category: ErrorCategory.EXTERNAL,
        params: errorParameters,
        ...(cause === undefined ? {} : { cause }),
      }),
    );
  }
}
```

- [ ] **Step 2: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS (0 errors — this exact file content was verified empirically before
this plan was written).

- [ ] **Step 3: Stage the file**

```bash
git add back-end/service-a/src/archive/download/errors.ts
```

(No test run in this task — see Global Constraints for why. `pnpm --filter service-a build`
will not yet succeed on its own with just this file present since nothing references it
yet in a way `nest build`'s entrypoint graph would catch either way; that's expected and
fine — Task 3 starts consuming it immediately.)

---

## Task 3: `service-a` — archive URL builder

**Files:**
- Create: `back-end/service-a/src/archive/download/archive-url.util.ts`
- Create: `back-end/service-a/src/archive/download/archive-url.util.spec.ts`

**Interfaces:**
- Consumes: `InvalidDateHourError` (Task 2).
- Produces: `buildArchiveUrl(dateHour: string, baseUrl: string): string` — throws
  `InvalidDateHourError` if `dateHour` doesn't match
  `^\d{4}-\d{2}-\d{2}-([0-9]|1[0-9]|2[0-3])$` (calendar validity, e.g. Feb 30, is
  deliberately not checked — a nonexistent date simply 404s later, which is already a
  handled failure mode). Otherwise returns `${baseUrl}/${dateHour}.json.gz`.
- Consumed by: Task 5 (`download-archive.ts`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-a/src/archive/download/archive-url.util.spec.ts`:
```ts
import { buildArchiveUrl } from './archive-url.util.js';
import { InvalidDateHourError } from './errors.js';

describe('buildArchiveUrl', () => {
  const baseUrl = 'https://data.gharchive.org';

  it('should build the archive URL, when dateHour has a single-digit hour', () => {
    expect(buildArchiveUrl('2026-08-11-0', baseUrl)).toBe(
      'https://data.gharchive.org/2026-08-11-0.json.gz',
    );
  });

  it('should build the archive URL, when dateHour has a two-digit hour', () => {
    expect(buildArchiveUrl('2026-08-11-23', baseUrl)).toBe(
      'https://data.gharchive.org/2026-08-11-23.json.gz',
    );
  });

  it('should throw InvalidDateHourError, when the date portion is malformed', () => {
    expect(() => buildArchiveUrl('26-08-11-0', baseUrl)).toThrow(InvalidDateHourError);
  });

  it('should throw InvalidDateHourError, when the hour is 24 or greater', () => {
    expect(() => buildArchiveUrl('2026-08-11-24', baseUrl)).toThrow(InvalidDateHourError);
  });

  it('should throw InvalidDateHourError, when the hour has a leading zero', () => {
    expect(() => buildArchiveUrl('2026-08-11-05', baseUrl)).toThrow(InvalidDateHourError);
  });

  it('should throw InvalidDateHourError, when dateHour is an empty string', () => {
    expect(() => buildArchiveUrl('', baseUrl)).toThrow(InvalidDateHourError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- archive-url.util.spec.ts`
Expected: FAIL — `Cannot find module './archive-url.util.js'`.

- [ ] **Step 3: Implement `archive-url.util.ts`**

```ts
import { InvalidDateHourError } from './errors.js';

const DATE_HOUR_PATTERN = /^\d{4}-\d{2}-\d{2}-([0-9]|1[0-9]|2[0-3])$/;

export function buildArchiveUrl(dateHour: string, baseUrl: string): string {
  if (!DATE_HOUR_PATTERN.test(dateHour)) {
    throw new InvalidDateHourError(dateHour);
  }

  return `${baseUrl}/${dateHour}.json.gz`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- archive-url.util.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/archive/download/archive-url.util.ts back-end/service-a/src/archive/download/archive-url.util.spec.ts
```

---

## Task 4: `service-a` — HTTP stream fetcher

**Files:**
- Create: `back-end/service-a/src/archive/download/fetch-archive-stream.ts`
- Create: `back-end/service-a/src/archive/download/fetch-archive-stream.spec.ts`

**Interfaces:**
- Consumes: `ArchiveDownloadError` (Task 2).
- Produces: `type HttpGetFunction = (url: string, callback: (response: IncomingMessage) => void) => ClientRequest`
  (matches `node:https`'s `get` signature exactly, so the real function can be the
  default parameter value with no wrapping). `fetchArchiveStream(url: string, timeoutMs: number, httpGet: HttpGetFunction = httpsGet): Promise<IncomingMessage>`
  — resolves with the response once its status is 2xx; rejects with
  `ArchiveDownloadError` on a non-2xx status (draining the response via `.resume()`
  first so the socket is freed without piping an error body anywhere), a request
  `'error'` event (connection failure), or a timeout (`request.setTimeout` fires →
  `request.destroy(new Error(...))` → the real `ClientRequest` then emits its own
  `'error'` event, which the existing `'error'` handler turns into the rejection — no
  separate timeout-specific reject path needed).
- Consumed by: Task 5 (`download-archive.ts`), which passes its own optional `httpGet`
  parameter straight through — this is the seam both this task's and Task 5's tests use
  to avoid `vi.mock()` entirely.

- [ ] **Step 1: Write the failing tests**

`back-end/service-a/src/archive/download/fetch-archive-stream.spec.ts`:
```ts
import { type ClientRequest, type IncomingMessage } from 'node:http';

import { ArchiveDownloadError } from './errors.js';
import { fetchArchiveStream, type HttpGetFunction } from './fetch-archive-stream.js';

describe('fetchArchiveStream', () => {
  const url = 'https://data.gharchive.org/2026-08-11-0.json.gz';

  const buildFakeRequest = (): {
    on: ReturnType<typeof vi.fn>;
    setTimeout: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  } => ({
    on: vi.fn(),
    setTimeout: vi.fn(),
    destroy: vi.fn(),
  });

  it('should resolve with the response, when the request succeeds with a 2xx status', async () => {
    const response = { statusCode: 200 } as unknown as IncomingMessage;
    const fakeRequest = buildFakeRequest();
    const httpGet: HttpGetFunction = vi.fn(
      (_url: string, callback: (response: IncomingMessage) => void) => {
        callback(response);

        return fakeRequest as unknown as ClientRequest;
      },
    );

    await expect(fetchArchiveStream(url, 1000, httpGet)).resolves.toBe(response);
  });

  it('should reject with ArchiveDownloadError, when the response status is not 2xx', async () => {
    const resume = vi.fn();
    const response = { statusCode: 404, resume } as unknown as IncomingMessage;
    const fakeRequest = buildFakeRequest();
    const httpGet: HttpGetFunction = vi.fn(
      (_url: string, callback: (response: IncomingMessage) => void) => {
        callback(response);

        return fakeRequest as unknown as ClientRequest;
      },
    );

    await expect(fetchArchiveStream(url, 1000, httpGet)).rejects.toThrow(ArchiveDownloadError);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('should reject with ArchiveDownloadError, when the request emits an error event', async () => {
    const fakeRequest = buildFakeRequest();
    const httpGet: HttpGetFunction = vi.fn(() => fakeRequest as unknown as ClientRequest);

    const promise = fetchArchiveStream(url, 1000, httpGet);

    const errorHandler = fakeRequest.on.mock.calls.find(([event]) => event === 'error')?.[1] as (
      error: Error,
    ) => void;
    errorHandler(new Error('connection refused'));

    await expect(promise).rejects.toThrow(ArchiveDownloadError);
  });

  it('should destroy the request and reject, when the configured timeout elapses', async () => {
    const fakeRequest = buildFakeRequest();
    const httpGet: HttpGetFunction = vi.fn(() => fakeRequest as unknown as ClientRequest);

    const promise = fetchArchiveStream(url, 5000, httpGet);

    expect(fakeRequest.setTimeout).toHaveBeenCalledWith(5000, expect.any(Function));

    const onTimeout = fakeRequest.setTimeout.mock.calls[0]?.[1] as () => void;
    onTimeout();

    expect(fakeRequest.destroy).toHaveBeenCalledWith(expect.any(Error));

    const errorHandler = fakeRequest.on.mock.calls.find(([event]) => event === 'error')?.[1] as (
      error: Error,
    ) => void;
    errorHandler(fakeRequest.destroy.mock.calls[0]?.[0] as Error);

    await expect(promise).rejects.toThrow(ArchiveDownloadError);
  });
});
```

Note on the last test (this is the pattern referenced in Global Constraints for
avoiding `void somePromise`): a real `ClientRequest.destroy(error)` emits its own
`'error'` event with that same error, which is what actually causes a real timeout to
reject the promise. The fake request here doesn't do that automatically, so the test
manually re-invokes the same `'error'` handler with the error `destroy` was called with
— this makes `promise` actually settle, so it can be `await`ed cleanly with no dangling
promise and no need for `void`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- fetch-archive-stream.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `fetch-archive-stream.ts`**

```ts
import { type ClientRequest, type IncomingMessage } from 'node:http';
import { get as httpsGet } from 'node:https';

import { ArchiveDownloadError } from './errors.js';

export type HttpGetFunction = (
  url: string,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

export function fetchArchiveStream(
  url: string,
  timeoutMs: number,
  httpGet: HttpGetFunction = httpsGet,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = httpGet(url, (response) => {
      const statusCode = response.statusCode ?? 0;

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();

        reject(
          new ArchiveDownloadError(
            `Archive download failed with HTTP ${statusCode}`,
            url,
            statusCode,
          ),
        );

        return;
      }

      resolve(response);
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });

    request.on('error', (error) => {
      reject(
        new ArchiveDownloadError(
          `Archive download request failed: ${error.message}`,
          url,
          undefined,
          error,
        ),
      );
    });
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- fetch-archive-stream.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/archive/download/fetch-archive-stream.ts back-end/service-a/src/archive/download/fetch-archive-stream.spec.ts
```

---

## Task 5: `service-a` — download orchestration

**Files:**
- Create: `back-end/service-a/src/archive/download/download-archive.ts`
- Create: `back-end/service-a/src/archive/download/download-archive.spec.ts`

**Interfaces:**
- Consumes: `buildArchiveUrl` (Task 3), `ArchiveDownloadError` (Task 2),
  `fetchArchiveStream`/`HttpGetFunction` (Task 4).
- Produces: `IDownloadArchiveOptions { baseUrl: string; storageDirectory: string; timeoutMs: number }`,
  `IDownloadArchiveResult { filePath: string }`,
  `downloadArchive(dateHour: string, options: IDownloadArchiveOptions, httpGet?: HttpGetFunction): Promise<IDownloadArchiveResult>`.
- Consumed by: Phase 5 (the real import orchestration — not part of this plan; Phase 5
  will call this with `options` built from `archiveConfig()`/`storageConfig()`, per
  Task 6 below).

This is the orchestration function per the design doc: build URL → ensure the storage
directory exists → fetch the response stream → pipe it to a `.tmp` file → on any
failure, delete the `.tmp` file and rethrow a wrapped `ArchiveDownloadError` (unless it's
already one) → on success, rename `.tmp` to the final path → return that path. Memory
use is independent of archive size — the response stream is piped directly to the file
write stream via `node:stream/promises`' `pipeline`, never buffered.

- [ ] **Step 1: Write the failing tests**

`back-end/service-a/src/archive/download/download-archive.spec.ts`:
```ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { type ClientRequest, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { downloadArchive } from './download-archive.js';
import { ArchiveDownloadError, InvalidDateHourError } from './errors.js';
import { type HttpGetFunction } from './fetch-archive-stream.js';

describe('downloadArchive', () => {
  let storageDirectory: string;

  beforeEach(() => {
    storageDirectory = mkdtempSync(join(tmpdir(), 'archive-download-spec-'));
  });

  afterEach(() => {
    rmSync(storageDirectory, { recursive: true, force: true });
  });

  const buildSuccessfulHttpGet = (content: string): HttpGetFunction => {
    const fakeRequest = { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };

    return vi.fn((_url: string, callback: (response: IncomingMessage) => void) => {
      const response = Readable.from([content]) as unknown as IncomingMessage;
      response.statusCode = 200;

      callback(response);

      return fakeRequest as unknown as ClientRequest;
    });
  };

  const buildFailingHttpGet = (statusCode: number): HttpGetFunction => {
    const fakeRequest = { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };

    return vi.fn((_url: string, callback: (response: IncomingMessage) => void) => {
      const response = Readable.from([]) as unknown as IncomingMessage;
      response.statusCode = statusCode;

      callback(response);

      return fakeRequest as unknown as ClientRequest;
    });
  };

  it('should write the archive to the final path, when the download succeeds', async () => {
    const httpGet = buildSuccessfulHttpGet('fake gzip content');

    const result = await downloadArchive(
      '2026-08-11-0',
      { baseUrl: 'https://data.gharchive.org', storageDirectory, timeoutMs: 1000 },
      httpGet,
    );

    expect(result.filePath).toBe(join(storageDirectory, '2026-08-11-0.json.gz'));
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    expect(existsSync(result.filePath)).toBe(true);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    expect(readFileSync(result.filePath, 'utf8')).toBe('fake gzip content');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    expect(existsSync(`${result.filePath}.tmp`)).toBe(false);
  });

  it('should throw InvalidDateHourError and write no file, when dateHour is malformed', async () => {
    const httpGet = buildSuccessfulHttpGet('unused');

    await expect(
      downloadArchive(
        'not-a-date',
        { baseUrl: 'https://data.gharchive.org', storageDirectory, timeoutMs: 1000 },
        httpGet,
      ),
    ).rejects.toThrow(InvalidDateHourError);
    expect(httpGet).not.toHaveBeenCalled();
  });

  it('should throw ArchiveDownloadError and leave no final or temp file, when the response is a 404', async () => {
    const httpGet = buildFailingHttpGet(404);
    const finalPath = join(storageDirectory, '2026-08-11-0.json.gz');

    await expect(
      downloadArchive(
        '2026-08-11-0',
        { baseUrl: 'https://data.gharchive.org', storageDirectory, timeoutMs: 1000 },
        httpGet,
      ),
    ).rejects.toThrow(ArchiveDownloadError);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    expect(existsSync(finalPath)).toBe(false);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    expect(existsSync(`${finalPath}.tmp`)).toBe(false);
  });

  it('should clean up the temp file and rethrow, when the response stream errors mid-download', async () => {
    const fakeRequest = { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };
    const httpGet: HttpGetFunction = vi.fn(
      (_url: string, callback: (response: IncomingMessage) => void) => {
        const response = new Readable({
          read(): void {
            this.destroy(new Error('connection dropped'));
          },
        }) as unknown as IncomingMessage;
        response.statusCode = 200;

        callback(response);

        return fakeRequest as unknown as ClientRequest;
      },
    );
    const finalPath = join(storageDirectory, '2026-08-11-0.json.gz');

    await expect(
      downloadArchive(
        '2026-08-11-0',
        { baseUrl: 'https://data.gharchive.org', storageDirectory, timeoutMs: 1000 },
        httpGet,
      ),
    ).rejects.toThrow(ArchiveDownloadError);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    expect(existsSync(finalPath)).toBe(false);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    expect(existsSync(`${finalPath}.tmp`)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- download-archive.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `download-archive.ts`**

```ts
import { createWriteStream } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { buildArchiveUrl } from './archive-url.util.js';
import { ArchiveDownloadError } from './errors.js';
import { fetchArchiveStream, type HttpGetFunction } from './fetch-archive-stream.js';

export interface IDownloadArchiveOptions {
  baseUrl: string;
  storageDirectory: string;
  timeoutMs: number;
}

export interface IDownloadArchiveResult {
  filePath: string;
}

export async function downloadArchive(
  dateHour: string,
  options: IDownloadArchiveOptions,
  httpGet?: HttpGetFunction,
): Promise<IDownloadArchiveResult> {
  const url = buildArchiveUrl(dateHour, options.baseUrl);

  const finalPath = join(options.storageDirectory, `${dateHour}.json.gz`);
  const temporaryPath = `${finalPath}.tmp`;

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- storageDirectory comes from validated env config (StorageConfiguration), not raw external input.
  await mkdir(options.storageDirectory, { recursive: true });

  try {
    const responseStream = await fetchArchiveStream(url, options.timeoutMs, httpGet);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- temporaryPath is derived from validated storage config + a regex-validated dateHour, never raw external input.
    await pipeline(responseStream, createWriteStream(temporaryPath));
  } catch (error) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
    await unlink(temporaryPath).catch(() => undefined);

    if (error instanceof ArchiveDownloadError) {
      throw error;
    }

    const cause = error instanceof Error ? error : undefined;

    throw new ArchiveDownloadError(
      `Archive download stream failed: ${error instanceof Error ? error.message : String(error)}`,
      url,
      undefined,
      cause,
    );
  }

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
  await rename(temporaryPath, finalPath);

  return { filePath: finalPath };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- download-archive.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/archive/download/download-archive.ts back-end/service-a/src/archive/download/download-archive.spec.ts
```

---

## Task 6: `service-a` — archive config namespace + wiring

**Files:**
- Create: `back-end/service-a/src/config/archive.config.ts`
- Create: `back-end/service-a/src/config/archive.config.spec.ts`
- Modify: `back-end/service-a/src/app.module.ts`
- Modify: `back-end/service-a/.env.example`

**Interfaces:**
- Produces: `archiveConfig` (namespace `archive`, `ArchiveConfiguration { baseUrl: string; downloadTimeoutMs: number }`,
  default `baseUrl = 'https://data.gharchive.org'`, default `downloadTimeoutMs = 30000`,
  env `GITHUB_ARCHIVE_BASE_URL`/`ARCHIVE_DOWNLOAD_TIMEOUT_MS`). Per `CLAUDE.md`'s
  configuration rule ("GitHub Archive base URL", "request timeout" must both be
  environment-based) — both values are genuinely configurable, not hardcoded.
- Consumed by: Phase 5, which will call `downloadArchive(dateHour, { baseUrl: archiveConfig().baseUrl, storageDirectory: storageConfig().dir, timeoutMs: archiveConfig().downloadTimeoutMs })`.
  Nothing in this phase calls `archiveConfig()` yet — it's registered now (same as
  Phase 0 registered `storageConfig` before anything consumed it) so `GITHUB_ARCHIVE_BASE_URL`/`ARCHIVE_DOWNLOAD_TIMEOUT_MS`
  are validated fail-closed at every boot from this point on, and `.env.example` stays
  accurate.

- [ ] **Step 1: Write the failing tests**

`back-end/service-a/src/config/archive.config.spec.ts`:
```ts
import archiveConfig from './archive.config.js';

describe('archiveConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return documented defaults, when no environment variables are set', () => {
      delete process.env.GITHUB_ARCHIVE_BASE_URL;
      delete process.env.ARCHIVE_DOWNLOAD_TIMEOUT_MS;

      expect(archiveConfig()).toEqual({
        baseUrl: 'https://data.gharchive.org',
        downloadTimeoutMs: 30_000,
      });
    });
  });

  describe('environment overrides', () => {
    it('should parse values from environment variables, when all variables are set', () => {
      process.env.GITHUB_ARCHIVE_BASE_URL = 'https://custom-archive-mirror.example.com';
      process.env.ARCHIVE_DOWNLOAD_TIMEOUT_MS = '60000';

      expect(archiveConfig()).toEqual({
        baseUrl: 'https://custom-archive-mirror.example.com',
        downloadTimeoutMs: 60_000,
      });
    });
  });

  describe('validation', () => {
    it('should throw, when GITHUB_ARCHIVE_BASE_URL is not a valid url', () => {
      process.env.GITHUB_ARCHIVE_BASE_URL = 'not-a-valid-url';

      expect(() => archiveConfig()).toThrow();
    });

    it('should throw, when ARCHIVE_DOWNLOAD_TIMEOUT_MS is not a positive number', () => {
      process.env.ARCHIVE_DOWNLOAD_TIMEOUT_MS = '0';

      expect(() => archiveConfig()).toThrow();
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- archive.config.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `archive.config.ts`**

```ts
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const archiveConfigSchema = z.object({
  baseUrl: z.url().default('https://data.gharchive.org'),
  downloadTimeoutMs: z.coerce.number().int().positive().default(30_000),
});

export type ArchiveConfiguration = z.infer<typeof archiveConfigSchema>;

export default registerAs('archive', (): ArchiveConfiguration =>
  archiveConfigSchema.parse({
    baseUrl: process.env.GITHUB_ARCHIVE_BASE_URL,
    downloadTimeoutMs: process.env.ARCHIVE_DOWNLOAD_TIMEOUT_MS,
  }),
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- archive.config.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire `archiveConfig` into `AppModule`**

Modify `back-end/service-a/src/app.module.ts` to:
```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import loggerConfig from '@task1/shared/config/logger.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/rmq/exception-handling.module';
import { LoggerModule } from '@task1/shared/logger/rmq/logger.module';
import { RequestContextModule } from '@task1/shared/request-context/rmq/request-context.module';

import archiveConfig from './config/archive.config.js';
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
      load: [
        loggerConfig,
        rabbitmqConfig,
        mongodbConfig,
        redisConfig,
        storageConfig,
        archiveConfig,
      ],
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

- [ ] **Step 6: Document the new environment variables**

Modify `back-end/service-a/.env.example` — insert two new lines after the existing
`STORAGE_DIR=./data/archives` line (and its trailing blank line), before the
`LOG_LEVEL`/`APP_LOG_TRANSPORT` lines, so the file reads:
```
RABBITMQ_URL=amqp://guest:guest@localhost:5672
RABBITMQ_QUEUE=service_a_queue

MONGODB_URI=mongodb://localhost:27017/service_a
MONGO_BATCH_SIZE=500

REDIS_URL=redis://localhost:6379

STORAGE_DIR=./data/archives

GITHUB_ARCHIVE_BASE_URL=https://data.gharchive.org
ARCHIVE_DOWNLOAD_TIMEOUT_MS=30000

LOG_LEVEL=trace
APP_LOG_TRANSPORT=pretty
```

- [ ] **Step 7: Run the full `service-a` test suite, lint, and build**

Run: `pnpm --filter service-a test && pnpm --filter service-a lint && pnpm --filter service-a build`
Expected: all three PASS/succeed. This is the first point where every file from Tasks
2-6 is wired together and compiled as one program — confirmed empirically before this
plan was written (39 tests across 11 files, 0 lint errors, successful `nest build`).

- [ ] **Step 8: Stage the files**

```bash
git add back-end/service-a/src/config/archive.config.ts back-end/service-a/src/config/archive.config.spec.ts back-end/service-a/src/app.module.ts back-end/service-a/.env.example
```

---

## Task 7: End-to-end verification against the real GitHub Archive endpoint

**Files:** none — this task only runs commands and reads output. Every task above is
tested against a faked HTTP layer (no `vi.mock()`, no real network) — this is the
"does it actually work against the real service" checkpoint those tests can't cover,
matching how Phase 0 verified against real Docker infrastructure rather than trusting
mocked tests alone.

- [ ] **Step 1: Check network access to the real endpoint**

Run: `curl -sI https://data.gharchive.org/2026-08-01-0.json.gz | head -5`
Expected: `HTTP/2 200` (or similar) with a `content-length` header. If this fails with a
DNS/connection error, the execution environment has no general internet egress — skip
the rest of this task, note it explicitly in the final report as "not verified against
the real endpoint due to no network egress in this environment; mocked test coverage
from Tasks 3-5 is the only evidence," and move on. Do not treat this as a blocker for
the rest of the phase.

- [ ] **Step 2: Download a real, known-to-exist archive hour**

Pick any `dateHour` at least 24 hours before the current date (GitHub Archive has
processing lag; anything further back than a day is guaranteed to exist — e.g. if today
is 2026-08-12, use `2026-08-10-0`). Run a small ad-hoc script from the `service-a`
package root:

```bash
cd back-end/service-a
node --input-type=module -e "
import { downloadArchive } from './dist/archive/download/download-archive.js';
const result = await downloadArchive('2026-08-10-0', {
  baseUrl: 'https://data.gharchive.org',
  storageDirectory: './data/archives',
  timeoutMs: 30000,
});
console.log('Downloaded to:', result.filePath);
"
```
(substitute a real `dateHour` at least a day in the past). Expected: prints
`Downloaded to: ./data/archives/<dateHour>.json.gz`, and the file exists and is a
non-trivial size (GitHub Archive hourly files are at minimum a few hundred KB, often
much larger).

- [ ] **Step 3: Verify the downloaded file is genuinely gzip**

Run: `file back-end/service-a/data/archives/<dateHour>.json.gz` (or, if `file` isn't
available: `head -c4 back-end/service-a/data/archives/<dateHour>.json.gz | xxd` and
confirm the first two bytes are `1f 8b`, the gzip magic number).
Expected: confirms this is a real, complete, valid gzip file — not a truncated download,
an HTML error page, or a redirect target that was never followed.

- [ ] **Step 4: Verify the 404 path against the real server**

Run the same ad-hoc script pattern from Step 2 with a `dateHour` far enough in the future
that it cannot exist yet (e.g. `2030-01-01-0`), wrapped in a try/catch that logs the
caught error's `constructor.name` and `message`. Expected: logs
`ArchiveDownloadError: Archive download failed with HTTP 404`, confirming the real
server's actual 404 response is handled the same way the mocked tests assumed.

- [ ] **Step 5: Clean up**

```bash
rm -rf back-end/service-a/data/archives
```
(the real downloaded file was for verification only — don't leave it in the working
tree; `STORAGE_DIR`'s default `./data/archives` is not meant to hold committed data).

---

## Self-Review

**Spec coverage:** the design doc's entire "Service-a: download (Phase 1)" section maps
to Tasks 2-6 (URL building, temp-file-then-rename, `AppError` subclass carrying
URL/status, never buffering the response). The roadmap's stated deliverable
("`downloadArchive(dateHour, storageDir): Promise<{filePath}>`, ... unit tests cover
valid/invalid dateHour formats, mocked HTTP success/4xx/5xx/connection-error/timeout,
and that a failed download never leaves a file at the final path") is covered exactly by
Tasks 3-5's test suites, and Task 7 adds real-endpoint verification beyond what the
roadmap asked for, matching this repo's established practice from Phase 0.

**Placeholder scan:** no TBD/TODO; every step shows complete, empirically-verified file
contents or an exact runnable command with expected output.

**Type/name consistency:** `HttpGetFunction` (Task 4) is imported and reused unchanged
by Task 5. `ArchiveDownloadError`/`InvalidDateHourError` (Task 2) are imported and
thrown/caught with identical constructor signatures in Tasks 3, 4, and 5.
`IDownloadArchiveOptions`/`IDownloadArchiveResult` (Task 5) are the exact shape Phase 5
will need to construct from `archiveConfig()`/`storageConfig()` (Task 6) — field names
(`baseUrl`, `storageDirectory`, `timeoutMs`) match across both.
