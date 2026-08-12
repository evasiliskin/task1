# Phase 3: Service-a Upload Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /v1/imports/upload` (gateway) accepts a `multipart/form-data` archive file,
streams it straight to disk on the shared `archive-storage` volume (never buffered in an
application `Buffer`), triggers `service-a`'s Phase 2 `processArchive` pipeline via a small
fire-and-forget RabbitMQ message, and returns `{ importId }` immediately — without waiting for
processing to finish.

**Architecture:** A new `back-end/api-gateway/src/imports/` module owns the HTTP surface:
`FileInterceptor` + Nest's `MulterModule` (DI-configured `diskStorage`, matching this repo's
existing `ClientsModule.registerAsync`-style config wiring) write the upload straight to
`STORAGE_DIR` under a temporary, server-generated-UUID filename; the controller renames it to
its final `<importId>.json.gz` path (same temp-then-rename safety pattern as Phase 1's
`downloadArchive`) and `emit()`s `{ importId, filePath }` to `service-a`. A new
`back-end/service-a/src/archive/` layer (`ArchiveModule`) gets its first real, DI-wired
consumer: an `EVENTS_COLLECTION` provider, a startup index initializer, and an
`ArchiveProcessingService` that wraps Phase 2's pure `processArchive` orchestration function
with the real Mongo collection, `mongodbConfig().batchSize`, and `LoggerService`-backed
`onInvalidLine` logging — consumed by a new `@EventPattern('archive.process.upload')` handler.
No new business logic is added to `processArchive` itself — per the design doc, this phase
"runs the exact same `processArchive` from Phase 2 — no separate upload-specific processing
code."

**Tech Stack:** `@nestjs/platform-express`'s `FileInterceptor`/`MulterModule` (already a gateway
dependency), `multer`'s `diskStorage` (new **direct** gateway dependency — see Global
Constraints Finding 2), Zod (already present), Vitest, Supertest.

**Design doc:** `docs/superpowers/specs/2026-08-12-github-archive-platform-design.md` (sections
"Service-a: upload endpoint (Phase 3)" and "Architecture" for the shared-volume rationale).
**Roadmap:** `docs/superpowers/plans/2026-08-12-github-archive-platform-plan.md` (Phase 3 of 11).
**Depends on:** Phase 2 (`processArchive`, `ensureEventIndexes`, `IGithubEventDocument` — all
already merged, verified present at `back-end/service-a/src/archive/processing/`). This phase
does **not** depend on Phase 5 (`importArchive`/domain-event emission) — the design doc is
explicit that the upload trigger calls Phase 2's `processArchive` directly; Phase 5 will later
wrap *all* import paths (download and upload alike) in `import.started/.completed/.failed`
emission, at which point `ArchiveProcessingService.process` gains that wrapping without this
phase's controller/module shape changing.

Every framework-specific behavior below (`ClientProxy.emit()`'s subscription semantics,
`MulterModule`/`FileInterceptor` interaction, multer's own TypeScript support) was verified
against current NestJS documentation via Context7 before this plan was written, and every file
path / existing convention was verified by reading this exact repository — not guessed. Four
non-obvious findings are called out below because they contradict a plausible-but-wrong
default assumption.

## Global Constraints

- Never throw raw `Error` — new errors extend `AppError`/`ValidationError` from
  `@task1/shared/errors/index`, exactly like Phase 1/2's `errors.ts` files.
- **Finding 1 — `ClientProxy.emit()` is a *hot* Observable; it does NOT need `firstValueFrom`/
  `lastValueFrom`/a manual `.subscribe()` call to actually dispatch, unlike `send()`.**
  Verified against current NestJS docs (`content/microservices/basics.md`): "Unlike `send()`,
  `emit()` returns a hot `Observable`, ensuring the proxy immediately attempts to deliver the
  event even without explicit subscription." (`send()`'s cold Observable, which DOES need a
  subscription, is what this repo's existing health-check code uses today — do not copy that
  pattern for the new `emit()` call.) The gateway's upload controller therefore calls
  `this.serviceAClient.emit(pattern, payload)` as a bare, un-awaited statement — this is
  correct, not a bug, and is not flagged by `@typescript-eslint/no-floating-promises` because
  an RxJS `Observable` is not a thenable.
- **Finding 2 — `multer` is not currently a resolvable import in `api-gateway` and must become
  a direct dependency.** Verified against this repo's actual `node_modules` layout: pnpm's
  strict (non-hoisted) linking means `multer@2.2.0` — a transitive dependency pulled in only by
  `@nestjs/platform-express` — exists solely inside `@nestjs/platform-express`'s own nested
  `node_modules`, not inside `back-end/api-gateway/node_modules`. `@nestjs/platform-express`
  re-exports `FileInterceptor`/`MulterModule`/`MulterOptions` but **not** `diskStorage`
  (confirmed against its compiled `multer/index.d.ts`: only `./interceptors`, `./interfaces`,
  `./multer.module` are re-exported). Task 1 adds `"multer": "^2.2.0"` to `api-gateway`'s own
  `package.json` `dependencies` so `import { diskStorage } from 'multer'` resolves.
- **Finding 3 — `multer@2.2.0` ships no bundled TypeScript types at all** (its `package.json`
  has no `types`/`typings` field and no `.d.ts` file exists anywhere in the installed package —
  confirmed by inspection). `@types/multer@2.2.0` exists on the registry and version-matches
  the installed runtime exactly; Task 1 adds it as an `api-gateway` devDependency. Without it,
  `Express.Multer.File` and `diskStorage`'s callback parameter types do not exist and the
  `imports` module fails to type-check.
- **Finding 4 — `MulterModule.registerAsync({ useFactory, inject })` sets the *module-scoped
  default* Multer options; a bare `FileInterceptor('file')` (no inline options argument) picks
  them up automatically.** Verified against current NestJS docs ("Configure Default Multer
  Options" / "Async configuration" sections of `content/techniques/file-upload.md`). This is
  why Task 5's controller calls `FileInterceptor('file')` with no second argument instead of
  calling `storageConfig()`/`uploadConfig()` directly inside a decorator (which would read
  `process.env` once at module-load time outside Nest's DI/config lifecycle, unlike every other
  config consumption in this repo).
- **The gateway does not currently have `STORAGE_DIR` configured or the `archive-storage`
  volume mounted** — verified against `docker-compose.yml` and `back-end/api-gateway/src/`:
  today only `service-a` has both. The design doc's Phase 0 section describes gateway storage
  config as if it already existed; it does not (this was not built when Phase 0 actually
  shipped). Task 1 adds it now, since Phase 3 is the first phase that needs the gateway to
  write archive bytes to the same shared volume `service-a` reads from.
- Multer's own `limits.fileSize` (not Nest's `ParseFilePipe`/`MaxFileSizeValidator`) is the
  correct place to bound upload size for a `diskStorage`-backed upload: it aborts the
  multipart stream mid-transfer once the limit is exceeded (verified against
  `content/techniques/file-upload.md`'s file-size-limit example), whereas `ParseFilePipe`'s
  validators only run after the file has already been fully written to disk — using both would
  be redundant and the disk-usage guard would arrive too late to matter.
- The `.json.gz` extension check happens as plain, explicit code in the controller (not a
  multer `fileFilter` callback) — this is a validation concern, which the Controller layer
  responsibility in `CLAUDE.md` explicitly owns, and keeps the check trivially unit-testable
  via the integration spec without exercising multer's callback plumbing.
- `unicorn/prevent-abbreviations` rejects short names (`req`/`res`/`Dto`/`dto`/`e2e`/`E2e` are
  the only allow-listed exceptions, confirmed in this repo's `eslint.config.js`) — every other
  parameter uses a full word (`request`, `file`, `callback`).
- `security/detect-non-literal-fs-filename` fires on every dynamic `fs`/`fs/promises` call
  (`rename`, `unlink`, `createReadStream`, etc.) — every such call in this plan carries a
  justified `// eslint-disable-next-line security/detect-non-literal-fs-filename -- <reason>`
  comment, matching Phase 1/2's convention.
- `@typescript-eslint/return-await: ['error', 'always']` only applies inside functions declared
  `async`. Methods that are pure promise-forwarding passthroughs (no other `await` in the body)
  are declared **without** the `async` keyword and `return` the promise directly — matching
  this repo's own `HealthController.check()` precedent — rather than being marked `async` and
  then needing `return await`.
- Type-only imports use inline `type` modifiers; relative imports use explicit `.js`
  extensions; imports grouped (builtin/external/internal/parent/sibling/index), alphabetized
  ascending case-insensitive, blank line between groups — matches Phase 0/1/2.
- Naming: `interface`s are `PascalCase` prefixed with `I`; `type` aliases are `PascalCase` with
  no prefix (matches the repo's enforced `@typescript-eslint/naming-convention` rule, confirmed
  in `eslint.config.js`).
- Blank line required before every `return`/`throw` following a `const`/`let`/`var` or
  expression statement, and before every `if`.
- No `git commit` restriction in this plan's execution worktree — per this repo's established
  convention (see Phase 0/1/2), commits inside an isolated implementation worktree are
  expected; per `CLAUDE.md`, only the user commits work outside such a worktree.
- BDD test naming: `it('should X, when Y')`. Coverage thresholds: 90% lines, 90% branches.
- Every `.int.spec.ts` mirrors `health.controller.int.spec.ts`'s exact `Test.createTestingModule`
  shape: a bare `ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [...] })`
  plus the real feature module, `overrideProvider` for the RMQ client, no `app.setGlobalPrefix`/
  `app.enableVersioning` (those are `main.ts`-only, so integration tests hit bare paths like
  `/imports/upload`, not `/api/v1/imports/upload` — confirmed against the existing Health
  integration spec, which hits bare `/health`). Because the controller under test throws custom
  `AppError` subclasses (not built-in Nest `HttpException`s), the test module **must** import
  `RequestContextModule` (http) and `ExceptionHandlingModule` (http) — unlike the Health
  integration spec, which never throws a custom error on its tested paths and gets away without
  them.
- No dedicated `*.spec.ts` for `errors.ts` files (gateway or service-a) — matches Phase 1/2's
  convention; their throw-behavior is exercised indirectly by the controllers' own tests.
- Message pattern string `'archive.process.upload'` is a plain literal duplicated in both the
  gateway (emit) and service-a (handler) call sites — matching this repo's existing
  `'health.check'` convention (also a bare duplicated literal, not a shared constant). The
  `EVENT_PATTERNS` constant in `@task1/shared/github-archive` is reserved for the three
  lifecycle domain events consumed by `service-b`, per the design doc's "Shared package
  additions" section — this is a different, internal gateway→service-a command, out of that
  contract's scope.
- The gateway's new `SERVICE_A_RMQ_CLIENT` token/`ClientsModule.registerAsync` registration is
  intentionally **module-scoped to `ImportsModule`**, duplicating (not sharing) `HealthModule`'s
  own existing, separately-scoped registration under the same token name — each module owns its
  own RMQ client dependency, matching this repo's existing per-module pattern exactly (no
  module boundary is crossed to reach into `src/health/`). Two independent AMQP connections to
  the same queue is an acceptable, low-risk trade-off at this project's scale; consolidating
  them into one shared, exported module is a reasonable future cleanup once a third consumer
  appears (e.g. Phase 4's search API), not something this phase should speculatively build.

---

## Task 1: Infra — gateway storage/upload config, `multer` dependency, docker-compose, `.env.example`

**Files:**
- Create: `back-end/api-gateway/src/config/storage.config.ts`
- Create: `back-end/api-gateway/src/config/storage.config.spec.ts`
- Create: `back-end/api-gateway/src/config/upload.config.ts`
- Create: `back-end/api-gateway/src/config/upload.config.spec.ts`
- Modify: `back-end/api-gateway/package.json`
- Modify: `docker-compose.yml`
- Modify: `back-end/api-gateway/.env.example`

**Interfaces:**
- Produces: `storageConfig().dir: string` (`STORAGE_DIR`, default `./data/archives` — identical
  shape to `service-a`'s existing `storage.config.ts`). `uploadConfig().maxFileSizeBytes: number`
  (`UPLOAD_MAX_FILE_SIZE_BYTES`, default 2 GiB).
- Consumed by: Task 5 (`ImportsModule`'s `MulterModule.registerAsync`), Task 6 (upload
  controller's final-path construction), Task 7 (`app.module.ts` config `load` array).

- [ ] **Step 1: Write the failing config tests**

`back-end/api-gateway/src/config/storage.config.spec.ts`:
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

`back-end/api-gateway/src/config/upload.config.spec.ts`:
```ts
import uploadConfig from './upload.config.js';

describe('uploadConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return the documented default, when no environment variable is set', () => {
      delete process.env.UPLOAD_MAX_FILE_SIZE_BYTES;

      expect(uploadConfig()).toEqual({ maxFileSizeBytes: 2_147_483_648 });
    });
  });

  describe('environment overrides', () => {
    it('should coerce the value from the environment variable, when it is set', () => {
      process.env.UPLOAD_MAX_FILE_SIZE_BYTES = '1000000';

      expect(uploadConfig()).toEqual({ maxFileSizeBytes: 1_000_000 });
    });
  });

  describe('validation', () => {
    it('should throw, when UPLOAD_MAX_FILE_SIZE_BYTES is zero', () => {
      process.env.UPLOAD_MAX_FILE_SIZE_BYTES = '0';

      expect(() => uploadConfig()).toThrow();
    });

    it('should throw, when UPLOAD_MAX_FILE_SIZE_BYTES is not numeric', () => {
      process.env.UPLOAD_MAX_FILE_SIZE_BYTES = 'not-a-number';

      expect(() => uploadConfig()).toThrow();
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter api-gateway test -- storage.config.spec.ts upload.config.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the config files**

`back-end/api-gateway/src/config/storage.config.ts`:
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

`back-end/api-gateway/src/config/upload.config.ts`:
```ts
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const DEFAULT_MAX_UPLOAD_FILE_SIZE_BYTES = 2_147_483_648;

const uploadConfigSchema = z.object({
  maxFileSizeBytes: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_MAX_UPLOAD_FILE_SIZE_BYTES),
});

export type UploadConfiguration = z.infer<typeof uploadConfigSchema>;

export default registerAs('upload', (): UploadConfiguration =>
  uploadConfigSchema.parse({
    maxFileSizeBytes: process.env.UPLOAD_MAX_FILE_SIZE_BYTES,
  }),
);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter api-gateway test -- storage.config.spec.ts upload.config.spec.ts`
Expected: PASS (3 tests + 4 tests).

- [ ] **Step 5: Add `multer`/`@types/multer` to `api-gateway`'s `package.json`**

In `back-end/api-gateway/package.json`, add to `"dependencies"` (alphabetical position, after
`"ioredis"` and before `"mongodb"`):
```json
    "multer": "^2.2.0",
```
and add to `"devDependencies"` (alphabetical position, after `"@types/express"` and before
`"@types/node"`):
```json
    "@types/multer": "^2.2.0",
```

- [ ] **Step 6: Install and verify**

Run: `pnpm install`
Expected: lockfile updates, `back-end/api-gateway/node_modules/multer` now resolves.

- [ ] **Step 7: Update `docker-compose.yml`**

In the `api-gateway` service block, add `STORAGE_DIR` to `environment:` and a new `volumes:`
key (matching `service-a`'s existing block shape exactly):
```yaml
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
```

- [ ] **Step 8: Update `back-end/api-gateway/.env.example`**

Append:
```
STORAGE_DIR=./data/archives
UPLOAD_MAX_FILE_SIZE_BYTES=2147483648
```

- [ ] **Step 9: Lint**

Run: `pnpm --filter api-gateway lint`
Expected: PASS.

- [ ] **Step 10: Stage the files**

```bash
git add back-end/api-gateway/src/config/storage.config.ts back-end/api-gateway/src/config/storage.config.spec.ts back-end/api-gateway/src/config/upload.config.ts back-end/api-gateway/src/config/upload.config.spec.ts back-end/api-gateway/package.json pnpm-lock.yaml docker-compose.yml back-end/api-gateway/.env.example
```

---

## Task 2: Gateway — upload storage filename/validation utilities

**Files:**
- Create: `back-end/api-gateway/src/imports/upload-storage.util.ts`
- Create: `back-end/api-gateway/src/imports/upload-storage.util.spec.ts`

**Interfaces:**
- Produces: `TEMP_UPLOAD_FILE_SUFFIX = '.tmp'`, `isArchiveFilename(filename: string): boolean`
  (true iff the filename ends in `.json.gz`, case-insensitive), `buildTempUploadFilename(importId:
  string): string` (`` `${importId}.tmp` ``), `parseImportIdFromTempFilename(filename: string):
  string` (strips the `.tmp` suffix), `buildFinalArchiveFilename(importId: string): string`
  (`` `${importId}.json.gz` ``).
- Consumed by: Task 5 (`ImportsModule`'s `diskStorage` `filename` callback), Task 6 (upload
  controller).

- [ ] **Step 1: Write the failing tests**

`back-end/api-gateway/src/imports/upload-storage.util.spec.ts`:
```ts
import {
  buildFinalArchiveFilename,
  buildTempUploadFilename,
  isArchiveFilename,
  parseImportIdFromTempFilename,
  TEMP_UPLOAD_FILE_SUFFIX,
} from './upload-storage.util.js';

describe('isArchiveFilename', () => {
  it('should return true, when the filename ends with .json.gz', () => {
    expect(isArchiveFilename('2026-08-11-0.json.gz')).toBe(true);
  });

  it('should return true, when the filename extension has mixed case', () => {
    expect(isArchiveFilename('archive.JSON.GZ')).toBe(true);
  });

  it('should return false, when the filename does not end with .json.gz', () => {
    expect(isArchiveFilename('archive.txt')).toBe(false);
  });

  it('should return false, when the filename has no extension', () => {
    expect(isArchiveFilename('archive')).toBe(false);
  });
});

describe('buildTempUploadFilename', () => {
  it('should append the temp suffix to the importId, when called', () => {
    expect(buildTempUploadFilename('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')).toBe(
      `a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11${TEMP_UPLOAD_FILE_SUFFIX}`,
    );
  });
});

describe('parseImportIdFromTempFilename', () => {
  it('should strip the temp suffix, when the filename has one', () => {
    expect(parseImportIdFromTempFilename('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.tmp')).toBe(
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    );
  });
});

describe('buildFinalArchiveFilename', () => {
  it('should append .json.gz to the importId, when called', () => {
    expect(buildFinalArchiveFilename('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')).toBe(
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.json.gz',
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter api-gateway test -- upload-storage.util.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `upload-storage.util.ts`**

```ts
export const TEMP_UPLOAD_FILE_SUFFIX = '.tmp';

const ARCHIVE_FILENAME_PATTERN = /\.json\.gz$/i;

export function isArchiveFilename(filename: string): boolean {
  return ARCHIVE_FILENAME_PATTERN.test(filename);
}

export function buildTempUploadFilename(importId: string): string {
  return `${importId}${TEMP_UPLOAD_FILE_SUFFIX}`;
}

export function parseImportIdFromTempFilename(filename: string): string {
  return filename.slice(0, -TEMP_UPLOAD_FILE_SUFFIX.length);
}

export function buildFinalArchiveFilename(importId: string): string {
  return `${importId}.json.gz`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter api-gateway test -- upload-storage.util.spec.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter api-gateway lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/api-gateway/src/imports/upload-storage.util.ts back-end/api-gateway/src/imports/upload-storage.util.spec.ts
```

---

## Task 3: Gateway — upload error types

**Files:**
- Create: `back-end/api-gateway/src/imports/errors.ts`

**Interfaces:**
- Consumes: `AppError`, `ErrorCategory`, `ValidationError` from `@task1/shared/errors/index`.
- Produces: `MissingUploadFileError extends ValidationError` (no params), `
  UnsupportedArchiveFormatError extends ValidationError` (constructor: `(filename: string)`,
  `params: { filename }`), `ArchiveUploadError extends AppError` (constructor: `(message:
  string, importId: string, cause?: Error)`, category `EXTERNAL`, `params: { importId }`) — the
  latter wraps a failure finalizing the upload (e.g. the temp-to-final `rename` step), matching
  Phase 1's `ArchiveDownloadError` shape for an external/IO failure distinct from a validation
  failure.
- Consumed by: Task 6 (upload controller).

- [ ] **Step 1: Create the error classes**

`back-end/api-gateway/src/imports/errors.ts`:
```ts
import { AppError, ErrorCategory, ValidationError } from '@task1/shared/errors/index';

export class MissingUploadFileError extends ValidationError {
  public constructor() {
    super(
      'No archive file was provided in the "file" form field',
      MissingUploadFileError.buildOptions({
        code: 'MISSING_UPLOAD_FILE',
        category: ErrorCategory.VALIDATION,
      }),
    );
  }
}

export class UnsupportedArchiveFormatError extends ValidationError {
  public constructor(filename: string) {
    super(
      `Unsupported archive file format: "${filename}" (expected a ".json.gz" file)`,
      UnsupportedArchiveFormatError.buildOptions({
        code: 'UNSUPPORTED_ARCHIVE_FORMAT',
        category: ErrorCategory.VALIDATION,
        params: { filename },
      }),
    );
  }
}

export class ArchiveUploadError extends AppError {
  public constructor(message: string, importId: string, cause?: Error) {
    super(
      message,
      ArchiveUploadError.buildOptions({
        code: 'ARCHIVE_UPLOAD_FAILED',
        category: ErrorCategory.EXTERNAL,
        params: { importId },
        ...(cause === undefined ? {} : { cause }),
      }),
    );
  }
}
```

- [ ] **Step 2: Lint**

Run: `pnpm --filter api-gateway lint`
Expected: PASS.

- [ ] **Step 3: Stage the file**

```bash
git add back-end/api-gateway/src/imports/errors.ts
```

(No test run in this task — matches Phase 1/2's convention for `errors.ts`; throw-behavior is
exercised by Task 8's integration tests.)

---

## Task 4: Gateway — RMQ client token and upload response DTO

**Files:**
- Create: `back-end/api-gateway/src/imports/rabbitmq-client.token.ts`
- Create: `back-end/api-gateway/src/imports/dto/upload-import-response.dto.ts`

**Interfaces:**
- Produces: `SERVICE_A_RMQ_CLIENT` (string DI token, module-scoped to `ImportsModule` — see
  Global Constraints), `UploadImportResponseDto { importId: string }` (constructed via `new
  UploadImportResponseDto(importId)`).
- Consumed by: Task 5 (`ImportsModule`), Task 6 (upload controller).

- [ ] **Step 1: Create the token file**

`back-end/api-gateway/src/imports/rabbitmq-client.token.ts`:
```ts
export const SERVICE_A_RMQ_CLIENT = 'SERVICE_A_RMQ_CLIENT';
```

- [ ] **Step 2: Create the response DTO**

`back-end/api-gateway/src/imports/dto/upload-import-response.dto.ts`:
```ts
import { ApiProperty } from '@nestjs/swagger';

export class UploadImportResponseDto {
  @ApiProperty({
    description: 'Public identifier of the newly created import run',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  public readonly importId: string;

  public constructor(importId: string) {
    this.importId = importId;
  }
}
```

- [ ] **Step 3: Lint**

Run: `pnpm --filter api-gateway lint`
Expected: PASS.

- [ ] **Step 4: Stage the files**

```bash
git add back-end/api-gateway/src/imports/rabbitmq-client.token.ts back-end/api-gateway/src/imports/dto/upload-import-response.dto.ts
```

---

## Task 5: Gateway — `ImportsModule` (Multer + RMQ client wiring)

**Files:**
- Create: `back-end/api-gateway/src/imports/imports.module.ts`

**Interfaces:**
- Consumes: `storageConfig`, `uploadConfig`, `rabbitmqConfig` (Task 1 / existing),
  `buildTempUploadFilename` (Task 2), `SERVICE_A_RMQ_CLIENT` (Task 4).
- Produces: `ImportsModule` — registers `SERVICE_A_RMQ_CLIENT` (RMQ, pointed at
  `rabbitmqConfig().serviceAQueue`) and the module-default Multer `diskStorage` + `limits`
  config consumed automatically by any bare `FileInterceptor('file')` inside this module (see
  Global Constraints Finding 4).
- Consumed by: Task 6 (declares `UploadImportController`), Task 7 (`app.module.ts`).

This task has no dedicated unit test of its own — `ClientsModule.registerAsync`/
`MulterModule.registerAsync` are framework wiring, exercised end-to-end by Task 8's integration
test (which overrides `SERVICE_A_RMQ_CLIENT` and asserts a real file lands on disk through the
real Multer configuration).

- [ ] **Step 1: Implement `imports.module.ts`**

```ts
import { randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';

import rabbitmqConfig from '../config/rabbitmq.config.js';
import storageConfig from '../config/storage.config.js';
import uploadConfig from '../config/upload.config.js';

import { SERVICE_A_RMQ_CLIENT } from './rabbitmq-client.token.js';
import { buildTempUploadFilename } from './upload-storage.util.js';
import { UploadImportController } from './upload-import.controller.js';

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
    MulterModule.registerAsync({
      inject: [storageConfig.KEY, uploadConfig.KEY],
      useFactory: (
        storageConfiguration: ConfigType<typeof storageConfig>,
        uploadConfiguration: ConfigType<typeof uploadConfig>,
      ) => ({
        storage: diskStorage({
          destination: (_request, _file, callback) => {
            callback(null, storageConfiguration.dir);
          },
          filename: (_request, _file, callback) => {
            callback(null, buildTempUploadFilename(randomUUID()));
          },
        }),
        limits: { fileSize: uploadConfiguration.maxFileSizeBytes },
      }),
    }),
  ],
  controllers: [UploadImportController],
})
export class ImportsModule {}
```

- [ ] **Step 2: Lint**

Run: `pnpm --filter api-gateway lint`
Expected: PASS (will fail until Task 6 creates `upload-import.controller.ts` — proceed to Task
6 before running this if executing tasks strictly in order; both are commonly implemented and
linted together).

- [ ] **Step 3: Stage the file**

```bash
git add back-end/api-gateway/src/imports/imports.module.ts
```

---

## Task 6: Gateway — upload controller

**Files:**
- Create: `back-end/api-gateway/src/imports/upload-import.controller.ts`

**Interfaces:**
- Consumes: `SERVICE_A_RMQ_CLIENT` (Task 4), `UploadImportResponseDto` (Task 4),
  `MissingUploadFileError`/`UnsupportedArchiveFormatError`/`ArchiveUploadError` (Task 3),
  `isArchiveFilename`/`buildFinalArchiveFilename`/`parseImportIdFromTempFilename` (Task 2),
  `storageConfig` (Task 1).
- Produces: `UploadImportController` — `POST /imports/upload` (full runtime path `/api/v1/
  imports/upload` once `main.ts`'s global prefix/versioning apply).
- Consumed by: Task 5 (`ImportsModule.controllers`), Task 8 (integration test).

This is the first controller in this codebase to combine file-interceptor upload handling with
the temp-then-rename safety pattern; there is no unit-test-only path for it (it has an HTTP
listener) — per the testing skill, it gets an `.int.spec.ts` (Task 8) instead of a `.spec.ts`.

- [ ] **Step 1: Implement `upload-import.controller.ts`**

```ts
import { rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import {
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { type ClientProxy } from '@nestjs/microservices';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';

import storageConfig from '../config/storage.config.js';

import { UploadImportResponseDto } from './dto/upload-import-response.dto.js';
import {
  ArchiveUploadError,
  MissingUploadFileError,
  UnsupportedArchiveFormatError,
} from './errors.js';
import { SERVICE_A_RMQ_CLIENT } from './rabbitmq-client.token.js';
import {
  buildFinalArchiveFilename,
  isArchiveFilename,
  parseImportIdFromTempFilename,
} from './upload-storage.util.js';

const ARCHIVE_PROCESS_UPLOAD_PATTERN = 'archive.process.upload';

@ApiTags('imports')
@Controller('imports')
export class UploadImportController {
  public constructor(@Inject(SERVICE_A_RMQ_CLIENT) private readonly serviceAClient: ClientProxy) {}

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiCreatedResponse({ type: UploadImportResponseDto })
  public async upload(@UploadedFile() file?: Express.Multer.File): Promise<UploadImportResponseDto> {
    if (file === undefined) {
      throw new MissingUploadFileError();
    }

    if (!isArchiveFilename(file.originalname)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- file.path is the temp path Multer just wrote inside the configured storage directory, not raw external input.
      await unlink(file.path).catch(() => undefined);

      throw new UnsupportedArchiveFormatError(file.originalname);
    }

    const importId = parseImportIdFromTempFilename(file.filename);
    const finalPath = join(storageConfig().dir, buildFinalArchiveFilename(importId));

    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- both paths are derived from the configured storage directory and a server-generated UUID, never raw external input.
      await rename(file.path, finalPath);
    } catch (error) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
      await unlink(file.path).catch(() => undefined);

      const cause = error instanceof Error ? error : undefined;

      throw new ArchiveUploadError(
        `Failed to finalize uploaded archive: ${error instanceof Error ? error.message : String(error)}`,
        importId,
        cause,
      );
    }

    this.serviceAClient.emit(ARCHIVE_PROCESS_UPLOAD_PATTERN, { importId, filePath: finalPath });

    return new UploadImportResponseDto(importId);
  }
}
```

- [ ] **Step 2: Lint both Task 5 and Task 6 files together**

Run: `pnpm --filter api-gateway lint`
Expected: PASS.

- [ ] **Step 3: Stage the file**

```bash
git add back-end/api-gateway/src/imports/upload-import.controller.ts
```

---

## Task 7: Gateway — upload controller integration test

**Files:**
- Create: `back-end/api-gateway/src/imports/upload-import.controller.int.spec.ts`

**Interfaces:**
- Consumes: `ImportsModule` (Task 5), `SERVICE_A_RMQ_CLIENT` (Task 4), `storageConfig`/
  `uploadConfig`/`rabbitmqConfig` (Task 1 / existing).

- [ ] **Step 1: Write the failing integration tests**

`back-end/api-gateway/src/imports/upload-import.controller.int.spec.ts`:
```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { Test, type TestingModule } from '@nestjs/testing';
import loggerConfig from '@task1/shared/config/logger.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/http/exception-handling.module';
import { RequestContextModule } from '@task1/shared/request-context/http/request-context.module';
import request from 'supertest';

import { AuthModule } from '../auth/auth.module.js';
import rabbitmqConfig from '../config/rabbitmq.config.js';
import storageConfig from '../config/storage.config.js';
import uploadConfig from '../config/upload.config.js';

import { ImportsModule } from './imports.module.js';
import { SERVICE_A_RMQ_CLIENT } from './rabbitmq-client.token.js';

type App = Parameters<typeof request>[0];
type EmittedMessage = { importId: string; filePath: string };

describe('UploadImportController (HTTP Integration)', () => {
  let app: INestApplication;
  let httpServer: App;
  let storageDirectory: string;
  let serviceAClient: { emit: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    storageDirectory = mkdtempSync(join(tmpdir(), 'upload-import-spec-'));
    process.env.STORAGE_DIR = storageDirectory;

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
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    httpServer = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
    rmSync(storageDirectory, { recursive: true, force: true });
    delete process.env.STORAGE_DIR;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /imports/upload', () => {
    it('should return 201 with importId, persist the file, and emit the process message, when a valid .json.gz file is uploaded', async () => {
      const response = await request(httpServer)
        .post('/imports/upload')
        .attach('file', Buffer.from('gzipped-content'), 'archive.json.gz');

      expect(response.status).toBe(201);
      expect(typeof (response.body as { importId: string }).importId).toBe('string');
      expect(serviceAClient.emit).toHaveBeenCalledTimes(1);

      const [pattern, payload] = serviceAClient.emit.mock.calls[0] as [string, EmittedMessage];

      expect(pattern).toBe('archive.process.upload');
      expect(payload.importId).toBe((response.body as { importId: string }).importId);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- payload.filePath is read back from this test's own mocked emit call for assertion, not external input.
      expect(readFileSync(payload.filePath, 'utf8')).toBe('gzipped-content');
    });

    it('should return 400 and not emit any message, when the uploaded file does not have a .json.gz extension', async () => {
      const response = await request(httpServer)
        .post('/imports/upload')
        .attach('file', Buffer.from('not gzip'), 'archive.txt');

      expect(response.status).toBe(400);
      expect(serviceAClient.emit).not.toHaveBeenCalled();
    });

    it('should return 400 and not emit any message, when no file is provided', async () => {
      const response = await request(httpServer).post('/imports/upload');

      expect(response.status).toBe(400);
      expect(serviceAClient.emit).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter api-gateway test -- upload-import.controller.int.spec.ts`
Expected: FAIL (module not found, until Tasks 5/6 exist — if run after them, this validates the
real implementation and should already pass; if any assertion fails, fix the controller/module
before proceeding).

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm --filter api-gateway test -- upload-import.controller.int.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Lint**

Run: `pnpm --filter api-gateway lint`
Expected: PASS.

- [ ] **Step 5: Stage the file**

```bash
git add back-end/api-gateway/src/imports/upload-import.controller.int.spec.ts
```

---

## Task 8: Gateway — wire `ImportsModule` into `app.module.ts`

**Files:**
- Modify: `back-end/api-gateway/src/app.module.ts`

**Interfaces:** none new — pure wiring.

- [ ] **Step 1: Update `app.module.ts`**

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
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Run the full gateway test suite**

Run: `pnpm --filter api-gateway test`
Expected: PASS (all existing tests plus the new ones from Tasks 1, 2, 7).

- [ ] **Step 3: Lint**

Run: `pnpm --filter api-gateway lint`
Expected: PASS.

- [ ] **Step 4: Stage the file**

```bash
git add back-end/api-gateway/src/app.module.ts
```

---

## Task 9: `service-a` — events collection provider

**Files:**
- Create: `back-end/service-a/src/archive/events-collection.provider.ts`
- Create: `back-end/service-a/src/archive/events-collection.provider.spec.ts`

**Interfaces:**
- Consumes: `MONGO_CLIENT` (existing, `back-end/service-a/src/infra/infra-clients.tokens.ts`),
  `type IGithubEventDocument` (Phase 0).
- Produces: `EVENTS_COLLECTION` (string DI token), `createEventsCollection(client: MongoClient):
  Collection<IGithubEventDocument>` (pure factory — the default database from the connection
  URI, `events` collection), `eventsCollectionProvider` (a ready-to-use Nest provider object:
  `{ provide: EVENTS_COLLECTION, inject: [MONGO_CLIENT], useFactory: createEventsCollection }`).
- Consumed by: Task 10 (`EnsureEventIndexesInitializer`), Task 11 (`ArchiveProcessingService`),
  Task 13 (`ArchiveModule`).

- [ ] **Step 1: Write the failing test**

`back-end/service-a/src/archive/events-collection.provider.spec.ts`:
```ts
import { type MongoClient } from 'mongodb';

import { createEventsCollection } from './events-collection.provider.js';

describe('createEventsCollection', () => {
  it('should return the events collection from the client default database, when called', () => {
    const collection = { collectionName: 'events' };
    const collectionFunction = vi.fn().mockReturnValue(collection);
    const db = vi.fn().mockReturnValue({ collection: collectionFunction });
    const client = { db } as unknown as MongoClient;

    const result = createEventsCollection(client);

    expect(result).toBe(collection);
    expect(collectionFunction).toHaveBeenCalledWith('events');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-a test -- events-collection.provider.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `events-collection.provider.ts`**

```ts
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection, type MongoClient } from 'mongodb';

import { MONGO_CLIENT } from '../infra/infra-clients.tokens.js';

export const EVENTS_COLLECTION = 'EVENTS_COLLECTION';

const EVENTS_COLLECTION_NAME = 'events';

export function createEventsCollection(client: MongoClient): Collection<IGithubEventDocument> {
  return client.db().collection<IGithubEventDocument>(EVENTS_COLLECTION_NAME);
}

export const eventsCollectionProvider = {
  provide: EVENTS_COLLECTION,
  inject: [MONGO_CLIENT],
  useFactory: createEventsCollection,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-a test -- events-collection.provider.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/archive/events-collection.provider.ts back-end/service-a/src/archive/events-collection.provider.spec.ts
```

---

## Task 10: `service-a` — startup index initializer

**Files:**
- Create: `back-end/service-a/src/archive/ensure-event-indexes-initializer.service.ts`
- Create: `back-end/service-a/src/archive/ensure-event-indexes-initializer.service.spec.ts`

**Interfaces:**
- Consumes: `EVENTS_COLLECTION` (Task 9), `ensureEventIndexes` (Phase 2,
  `back-end/service-a/src/archive/processing/ensure-event-indexes.ts`), `LoggerService` from
  `@task1/shared/logger/rmq/logger.service`.
- Produces: `EnsureEventIndexesInitializer implements OnModuleInit` — the first real caller of
  Phase 2's `ensureEventIndexes` against a live `Collection`, closing the gap the Phase 2 plan
  explicitly deferred ("nothing in this phase calls it yet... belongs to whichever phase gets a
  real `Collection` and an `OnModuleInit` hook to call it from").
- Consumed by: Task 13 (`ArchiveModule.providers`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-a/src/archive/ensure-event-indexes-initializer.service.spec.ts`:
```ts
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Collection } from 'mongodb';

import { EnsureEventIndexesInitializer } from './ensure-event-indexes-initializer.service.js';

describe('EnsureEventIndexesInitializer', () => {
  it('should create the unique eventId index and log success, when the module initializes', async () => {
    const createIndex = vi.fn().mockResolvedValue('eventId_1');
    const collection = { createIndex } as unknown as Collection<IGithubEventDocument>;
    const infoMock = vi.fn();
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ info: infoMock }),
    } as unknown as LoggerService;
    const initializer = new EnsureEventIndexesInitializer(collection, loggerService);

    await initializer.onModuleInit();

    expect(createIndex).toHaveBeenCalledWith({ eventId: 1 }, { unique: true });
    expect(infoMock).toHaveBeenCalledWith({}, 'Ensured events collection indexes');
  });

  it('should propagate the error, when index creation fails', async () => {
    const createIndex = vi.fn().mockRejectedValue(new Error('connection refused'));
    const collection = { createIndex } as unknown as Collection<IGithubEventDocument>;
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ info: vi.fn() }),
    } as unknown as LoggerService;
    const initializer = new EnsureEventIndexesInitializer(collection, loggerService);

    await expect(initializer.onModuleInit()).rejects.toThrow('connection refused');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter service-a test -- ensure-event-indexes-initializer.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ensure-event-indexes-initializer.service.ts`**

```ts
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Collection } from 'mongodb';

import { ensureEventIndexes } from './processing/ensure-event-indexes.js';
import { EVENTS_COLLECTION } from './events-collection.provider.js';

@Injectable()
export class EnsureEventIndexesInitializer implements OnModuleInit {
  public constructor(
    @Inject(EVENTS_COLLECTION) private readonly collection: Collection<IGithubEventDocument>,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger('EnsureEventIndexesInitializer');
  }

  public async onModuleInit(): Promise<void> {
    await ensureEventIndexes(this.collection);

    this.logger.info({}, 'Ensured events collection indexes');
  }

  private readonly logger: AppLogger;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter service-a test -- ensure-event-indexes-initializer.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/archive/ensure-event-indexes-initializer.service.ts back-end/service-a/src/archive/ensure-event-indexes-initializer.service.spec.ts
```

---

## Task 11: `service-a` — inbound upload message schema

**Files:**
- Create: `back-end/service-a/src/archive/upload/upload-import-message.schema.ts`
- Create: `back-end/service-a/src/archive/upload/upload-import-message.schema.spec.ts`

**Interfaces:**
- Produces: `uploadImportMessageSchema` (Zod), `type UploadImportMessage = { importId: string;
  filePath: string }`.
- Consumed by: Task 12 (`UploadImportController`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-a/src/archive/upload/upload-import-message.schema.spec.ts`:
```ts
import { uploadImportMessageSchema } from './upload-import-message.schema.js';

describe('uploadImportMessageSchema', () => {
  const validMessage = {
    importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    filePath: '/data/archives/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.json.gz',
  };

  it('should accept a valid message, when importId is a UUID and filePath is non-empty', () => {
    expect(uploadImportMessageSchema.parse(validMessage)).toEqual(validMessage);
  });

  it('should throw, when importId is not a UUID', () => {
    expect(() =>
      uploadImportMessageSchema.parse({ ...validMessage, importId: 'not-a-uuid' }),
    ).toThrow();
  });

  it('should throw, when filePath is missing', () => {
    const { filePath, ...withoutFilePath } = validMessage;

    expect(() => uploadImportMessageSchema.parse(withoutFilePath)).toThrow();
  });

  it('should throw, when filePath is an empty string', () => {
    expect(() =>
      uploadImportMessageSchema.parse({ ...validMessage, filePath: '' }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter service-a test -- upload-import-message.schema.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `upload-import-message.schema.ts`**

```ts
import { z } from 'zod';

export const uploadImportMessageSchema = z.object({
  importId: z.uuid(),
  filePath: z.string().min(1),
});

export type UploadImportMessage = z.infer<typeof uploadImportMessageSchema>;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter service-a test -- upload-import-message.schema.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/archive/upload/upload-import-message.schema.ts back-end/service-a/src/archive/upload/upload-import-message.schema.spec.ts
```

---

## Task 12: `service-a` — `ArchiveProcessingService`

**Files:**
- Create: `back-end/service-a/src/archive/upload/archive-processing.service.ts`
- Create: `back-end/service-a/src/archive/upload/archive-processing.service.spec.ts`

**Interfaces:**
- Consumes: `EVENTS_COLLECTION` (Task 9), `mongodbConfig` (existing), `processArchive`/`type
  ImportResult` (Phase 2), `LoggerService` (`@task1/shared/logger/rmq/logger.service`).
- Produces: `ArchiveProcessingService.process(filePath: string, importId: string):
  Promise<ImportResult>` — the DI-wired application-service wrapper around Phase 2's pure
  orchestration function, providing the real Mongo collection, `mongodbConfig().batchSize`, and
  a `LoggerService`-backed `onInvalidLine` implementation (the first real consumer of that
  optional callback).
- Consumed by: Task 13 (`UploadImportController`, `ArchiveModule`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-a/src/archive/upload/archive-processing.service.spec.ts`:
```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Collection } from 'mongodb';

import { type MongodbConfiguration } from '../../config/mongodb.config.js';

import { ArchiveProcessingService } from './archive-processing.service.js';

describe('ArchiveProcessingService', () => {
  let storageDirectory: string;

  beforeEach(() => {
    storageDirectory = mkdtempSync(join(tmpdir(), 'archive-processing-spec-'));
  });

  afterEach(() => {
    rmSync(storageDirectory, { recursive: true, force: true });
  });

  function buildService(
    collection: Collection<IGithubEventDocument>,
    warnMock: ReturnType<typeof vi.fn>,
  ): ArchiveProcessingService {
    const mongodbConfiguration: MongodbConfiguration = {
      uri: 'mongodb://localhost:27017/service_a',
      batchSize: 250,
    };
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ warn: warnMock }),
    } as unknown as LoggerService;

    return new ArchiveProcessingService(collection, mongodbConfiguration, loggerService);
  }

  function writeGzippedArchive(lines: string[]): string {
    const filePath = join(storageDirectory, 'archive.json.gz');
    const gzipped = gzipSync(Buffer.from(`${lines.join('\n')}\n`));

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    writeFileSync(filePath, gzipped);

    return filePath;
  }

  it('should return the pipeline result using the injected batchSize and log invalid lines through the logger, when processing an archive with valid and invalid lines', async () => {
    const validLine = JSON.stringify({
      id: '1',
      type: 'WatchEvent',
      created_at: '2026-08-11T00:00:00Z',
      actor: { id: 1, login: 'octocat' },
      repo: { id: 2, name: 'octocat/hello-world' },
      payload: {},
    });
    const filePath = writeGzippedArchive([validLine, 'not valid json']);
    const insertMany = vi.fn().mockResolvedValue({ insertedCount: 1 });
    const collection = { insertMany } as unknown as Collection<IGithubEventDocument>;
    const warnMock = vi.fn();
    const service = buildService(collection, warnMock);

    const result = await service.process(filePath, 'import-1');

    expect(result).toEqual({
      eventsProcessed: 2,
      validEvents: 1,
      invalidEvents: 1,
      duplicateEvents: 0,
      errorCount: 0,
    });
    expect(insertMany).toHaveBeenCalledWith(
      [expect.objectContaining({ eventId: '1', importId: 'import-1' })],
      { ordered: false },
    );
    expect(warnMock).toHaveBeenCalledWith(
      { importId: 'import-1', rawLine: 'not valid json', error: expect.any(String) },
      'Skipped invalid archive line',
    );
  });

  it('should propagate ArchiveProcessingError, when the archive file does not exist', async () => {
    const missingPath = join(storageDirectory, 'does-not-exist.json.gz');
    const collection = { insertMany: vi.fn() } as unknown as Collection<IGithubEventDocument>;
    const warnMock = vi.fn();
    const service = buildService(collection, warnMock);

    await expect(service.process(missingPath, 'import-1')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter service-a test -- archive-processing.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `archive-processing.service.ts`**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Collection } from 'mongodb';

import mongodbConfig from '../../config/mongodb.config.js';
import { EVENTS_COLLECTION } from '../events-collection.provider.js';
import { type ImportResult, processArchive } from '../processing/process-archive.js';

const INVALID_LINE_LOG_MESSAGE = 'Skipped invalid archive line';

@Injectable()
export class ArchiveProcessingService {
  public constructor(
    @Inject(EVENTS_COLLECTION) private readonly collection: Collection<IGithubEventDocument>,
    @Inject(mongodbConfig.KEY)
    private readonly mongodbConfiguration: ConfigType<typeof mongodbConfig>,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger('ArchiveProcessingService');
  }

  public process(filePath: string, importId: string): Promise<ImportResult> {
    return processArchive(
      filePath,
      importId,
      { collection: this.collection, batchSize: this.mongodbConfiguration.batchSize },
      (rawLine, error) => {
        this.logger.warn(
          { importId, rawLine, error: error instanceof Error ? error.message : String(error) },
          INVALID_LINE_LOG_MESSAGE,
        );
      },
    );
  }

  private readonly logger: AppLogger;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter service-a test -- archive-processing.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-a/src/archive/upload/archive-processing.service.ts back-end/service-a/src/archive/upload/archive-processing.service.spec.ts
```

---

## Task 13: `service-a` — `UploadImportController`, `ArchiveModule`, `app.module.ts` wiring

**Files:**
- Create: `back-end/service-a/src/archive/upload/upload-import.controller.ts`
- Create: `back-end/service-a/src/archive/upload/upload-import.controller.spec.ts`
- Create: `back-end/service-a/src/archive/archive.module.ts`
- Modify: `back-end/service-a/src/app.module.ts`

**Interfaces:**
- Consumes: `ArchiveProcessingService` (Task 12), `uploadImportMessageSchema` (Task 11),
  `eventsCollectionProvider` (Task 9), `EnsureEventIndexesInitializer` (Task 10).
- Produces: `UploadImportController` — `@EventPattern('archive.process.upload')` (fire-and-
  forget consumer, no reply — matches the gateway's `emit()` call in Task 6), `ArchiveModule`.

- [ ] **Step 1: Write the failing controller tests**

`back-end/service-a/src/archive/upload/upload-import.controller.spec.ts`:
```ts
import { type ArchiveProcessingService } from './archive-processing.service.js';
import { UploadImportController } from './upload-import.controller.js';

describe('UploadImportController', () => {
  const validPayload = {
    importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    filePath: '/data/archives/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.json.gz',
  };

  it('should call ArchiveProcessingService.process with the validated filePath and importId, when the payload is valid', async () => {
    const process = vi.fn().mockResolvedValue({
      eventsProcessed: 1,
      validEvents: 1,
      invalidEvents: 0,
      duplicateEvents: 0,
      errorCount: 0,
    });
    const archiveProcessingService = { process } as unknown as ArchiveProcessingService;
    const controller = new UploadImportController(archiveProcessingService);

    await controller.handleUpload(validPayload);

    expect(process).toHaveBeenCalledWith(validPayload.filePath, validPayload.importId);
  });

  it('should throw and not call ArchiveProcessingService.process, when the payload fails schema validation', async () => {
    const process = vi.fn();
    const archiveProcessingService = { process } as unknown as ArchiveProcessingService;
    const controller = new UploadImportController(archiveProcessingService);

    await expect(controller.handleUpload({ importId: 'not-a-uuid' })).rejects.toThrow();
    expect(process).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter service-a test -- upload-import.controller.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `upload-import.controller.ts`**

```ts
import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

import { ArchiveProcessingService } from './archive-processing.service.js';
import { uploadImportMessageSchema } from './upload-import-message.schema.js';

@Controller()
export class UploadImportController {
  public constructor(private readonly archiveProcessingService: ArchiveProcessingService) {}

  @EventPattern('archive.process.upload')
  public async handleUpload(@Payload() payload: unknown): Promise<void> {
    const { importId, filePath } = uploadImportMessageSchema.parse(payload);

    await this.archiveProcessingService.process(filePath, importId);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter service-a test -- upload-import.controller.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Implement `archive.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { LoggerModule } from '@task1/shared/logger/rmq/logger.module';

import { EnsureEventIndexesInitializer } from './ensure-event-indexes-initializer.service.js';
import { eventsCollectionProvider } from './events-collection.provider.js';
import { ArchiveProcessingService } from './upload/archive-processing.service.js';
import { UploadImportController } from './upload/upload-import.controller.js';

@Module({
  imports: [LoggerModule],
  controllers: [UploadImportController],
  providers: [eventsCollectionProvider, EnsureEventIndexesInitializer, ArchiveProcessingService],
})
export class ArchiveModule {}
```

- [ ] **Step 6: Wire `ArchiveModule` into `app.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import loggerConfig from '@task1/shared/config/logger.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/rmq/exception-handling.module';
import { LoggerModule } from '@task1/shared/logger/rmq/logger.module';
import { RequestContextModule } from '@task1/shared/request-context/rmq/request-context.module';

import { ArchiveModule } from './archive/archive.module.js';
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
    ArchiveModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 7: Run the full service-a test suite**

Run: `pnpm --filter service-a test`
Expected: PASS (all existing tests plus the new ones from Tasks 9–13).

- [ ] **Step 8: Lint**

Run: `pnpm --filter service-a lint`
Expected: PASS.

- [ ] **Step 9: Stage the files**

```bash
git add back-end/service-a/src/archive/upload/upload-import.controller.ts back-end/service-a/src/archive/upload/upload-import.controller.spec.ts back-end/service-a/src/archive/archive.module.ts back-end/service-a/src/app.module.ts
```

---

## Self-Review

**Spec coverage:** every element of the design doc's "Service-a: upload endpoint (Phase 3)"
section is covered — `POST /v1/imports/upload` accepting `multipart/form-data` (Task 6),
streaming to disk via `FileInterceptor`+`diskStorage` pointed at `STORAGE_DIR` (Task 5),
generated-`importId`-named path with temp-then-rename (Tasks 2, 6), small RMQ message `{
importId, filePath }` to service-a (Task 6), service-a running "the exact same `processArchive`
from Phase 2 — no separate upload-specific processing code" (Task 12 wraps but never
reimplements Phase 2's pipeline; Task 13's handler calls only `ArchiveProcessingService.process`,
which calls `processArchive` unchanged).

**Placeholder scan:** no TBD/TODO; every step shows complete code, including Task 12's fixture-
backed tests (a real gzipped temp file, asserting both the returned counters and the
`onInvalidLine`-to-logger wiring).

**Type/name consistency:** `EVENTS_COLLECTION` (Task 9) is the exact token used unchanged by
Tasks 10, 12, 13. `ImportResult` (Phase 2, reused verbatim, never redefined). `UploadImportMessage`
(Task 11) fields (`importId`, `filePath`) match exactly what Task 6's gateway controller emits
and what Task 13's handler destructures. `SERVICE_A_RMQ_CLIENT` (Task 4) is used identically in
Tasks 5, 6, 7. `ArchiveProcessingService.process(filePath, importId)` parameter order is used
identically in Task 12's implementation, Task 12's tests, and Task 13's controller/tests.
