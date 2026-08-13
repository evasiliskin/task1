# Phase 9: Service-b PDF Report Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /reports/pdf?importId=...` (gateway) — generates a PDF processing report (summary counters
plus two charts) from the exact same `IStatsResult` Phase 8's `GET /stats` already computes, either scoped
to one import or aggregated across all imports when `importId` is omitted. `service-b` builds the PDF with
`pdfkit`, streamed directly to a file on a new shared `report-storage` Docker volume
(`doc.pipe(createWriteStream(reportPath))`, never fully buffered), replies to the triggering RMQ message
with `{ reportPath }`, and the gateway streams that file straight back to the HTTP client
(`createReadStream(reportPath)` wrapped in a NestJS `StreamableFile`), deleting it once the response
finishes.

**Architecture:** A new `back-end/service-b/src/reports/` top-level module (`ReportsModule`) holds the pure
step functions — `report-charts.ts` (three pdfkit-drawing step functions), `report-path.util.ts`
(filename builder), `generate-report-message.schema.ts` (Zod validation for the inbound RMQ payload) — plus
`build-report.ts` (orchestration: stats → PDF file), `generate-report.ts` (orchestration: stats service →
`build-report.ts` → `{reportPath}`, dependency-injected the same way `import-archive.ts`'s
`IImportArchiveDependencies` already is in this repo), `ReportsService` (DI wrapper), and
`ReportsController` (`@MessagePattern('reports.pdf.generate')`). `ReportsModule` imports the existing
`ProcessingLogModule` and consumes its newly-exported `StatsService` — no new Mongo/Redis access is added
by this phase, so `reports/` owns no persistence itself, matching `CLAUDE.md`'s "communication between
modules must happen only through exported services" rule. On the gateway side, a new
`back-end/api-gateway/src/reports/` module owns `GET /reports/pdf`: a class-validator `GetReportQueryDto`,
a module-scoped `SERVICE_B_RMQ_CLIENT` (the same per-module-duplication pattern `StatsModule`/`LogsModule`
already use), and a `ReportsController` that RPCs service-b for the file path, then streams the file back
using NestJS's built-in `StreamableFile`.

**Tech Stack:** `pdfkit` (net-new dependency, vector PDF generation), `@nestjs/microservices`
(`ClientProxy.send`, `@MessagePattern`, `@Ctx`, `RmqContext`), `@nestjs/common`'s `StreamableFile` (file
streaming HTTP responses), Zod (service-b inbound message validation), `class-validator`/`class-transformer`
(gateway query DTO), Vitest.

**Design doc:** `docs/superpowers/specs/2026-08-12-github-archive-platform-design.md` (section "Service-b:
PDF report generation (Phase 9)").
**Roadmap:** `docs/superpowers/plans/2026-08-12-github-archive-platform-plan.md` (Phase 9 of 11) — reuses
`IStatsResult`/`IImportTimeSeriesPoint` from Phase 8 unchanged.
**Depends on:** Phase 6 (`ProcessingLogModule`), Phase 8 (`StatsService.getStats(importId?): Promise<IStatsResult>`,
`IImportTimeSeriesPoint`, both already downsampled to ≤50 points — verified in
`back-end/service-b/src/processing-log/stats/stats-metrics-reader.service.ts` and
`derive-import-duration-stats.ts`).

Every file path, existing convention, and framework detail below was verified by reading this exact
repository's current state (post-Phase-8) before this plan was written, including confirming `pdfkit` is
not yet a dependency anywhere in the repo, that `docker-compose.yml` currently defines only the
`archive-storage` volume (not `report-storage`, despite the design doc listing both under "Infrastructure
changes"), and that `ProcessingLogModule` does not yet `export` `StatsService`. Several non-obvious findings
are called out below because implementing this phase from the design doc's prose alone would either
duplicate work Phase 8 already did or invent infrastructure that doesn't yet exist.

## Global Constraints

- **Finding 1 — the design doc's own phase-decomposition table lists `report-storage`/`REPORT_DIR` under
  Phase 0 "Infrastructure changes", but the actual `docker-compose.yml` only has `archive-storage` (verified
  directly).** Phase 0's own plan scoped its infrastructure changes to what Phases 1–3 needed
  (`archive-storage`, used by the download/upload flows); `report-storage` genuinely isn't needed until this
  phase's PDF file has somewhere shared to live. Task 12 below adds it now — new named volume mounted at
  `/data/reports` in both `service-b` and `api-gateway`, mirroring the existing `archive-storage`/
  `STORAGE_DIR` pattern exactly (same env var name and mount path in both containers, so the `reportPath`
  service-b returns is directly readable by the gateway with no path translation).
- **Finding 2 — Phase 8 already produces a downsampled time series; this phase does not re-downsample.**
  The design doc's Phase 9 prose says to "gather downsampled time-series data... capped at ~50 points" as
  if that were new work for this phase. It isn't: `StatsMetricsReader.readEventsTimeSeries` (aggregate case)
  and `deriveImportDurationStats` (single-import case) — both already shipped in Phase 8 — already cap
  `IStatsResult.timeSeries` at ≤50 points before it ever reaches this phase. `generateReport` (Task 6) calls
  `StatsService.getStats(importId)` as-is and passes its `timeSeries` straight to the chart-drawing step
  function — no new `downsample-series.ts` is written, avoiding dead duplicate logic.
- **Finding 3 — service-b has no "events by type" data to chart.** The design doc's prose lists "events
  processed over time, events by type, success/failure" as the three charts. `processing-logs` documents
  (owned by `service-b`, Phase 6) only carry the five numeric counters from `ImportCompletedEvent`'s
  `metadata` — there is no per-GitHub-event-type breakdown (`PushEvent`/`IssuesEvent`/etc.) anywhere in
  `service-b`; that breakdown lives only in `service-a`'s `events` collection, a different service's
  persistence, off-limits per `CLAUDE.md`'s module-boundary rule ("database access belongs only to the
  owning module", and cross-service Mongo access was never part of this design). This phase therefore draws
  two charts derivable from `IStatsResult` alone: events-processed-over-time (a line chart from
  `timeSeries`) and a success/invalid/error outcome breakdown (a three-bar chart from `successfulEvents`/
  `invalidEvents`/`errors`) — plus a text summary block. A per-GitHub-event-type chart is out of scope for
  this phase, same spirit as Phase 8's own documented trade-offs.
- **Finding 4 — this repo has no existing precedent for streaming a file back through an HTTP response.**
  (Upload, Phases 3/5, only goes the other direction: client → gateway → disk.) This phase uses NestJS's
  built-in `StreamableFile` (`@nestjs/common`), returned from a controller with
  `@Res({ passthrough: true })` used only to attach a `'finish'` cleanup listener — the officially documented
  pattern (`createReadStream(...)` wrapped in `new StreamableFile(stream, { type, disposition })`), not a
  hand-rolled `stream.pipe(res)`.
- **Finding 5 — no `NotFoundError`/404 mapping exists in this codebase yet.**
  `back-end/libs/shared/src/exception-handling/status-from-app-error.utility.ts` only maps `AuthError` → 401
  and `ValidationError` → 400; every other `AppError` (including the unused `ErrorCategory.NOT_FOUND`) falls
  through to 500. Adding a new category-to-status mapping is a cross-cutting change to shared
  exception-handling code well outside this phase's scope (`CLAUDE.md`'s "no unrelated refactoring"). Instead,
  an `importId` with no matching `processing-logs` documents behaves exactly like Phase 8's `GET /stats`
  already does for the same input: `shapeStats([])` returns all-zero counters, `deriveImportDurationStats([])`
  returns `{ timeSeries: [] }`, and this phase's `generateReport` builds a (valid, if unexciting) PDF showing
  zeros rather than erroring — consistent behavior across both endpoints for an unknown `importId`, no new
  error class needed.
- **Finding 6 — `pdfkit` ships no bundled TypeScript types; `@types/pdfkit`'s own exported type shape isn't
  worth depending on directly.** `report-charts.ts` (Task 5) defines `type PdfDocument =
  InstanceType<typeof PDFDocument>` from a `import type PDFDocument from 'pdfkit'` — this works regardless
  of exactly how `@types/pdfkit` structures its namespace, and gives every chart-drawing function a concrete,
  narrow parameter type instead of `any`/`unknown`.
- **No new `AppError` subclass this phase.** `generateReportMessageSchema.parse()` failures propagate as a
  `ZodError` exactly like Phase 8's `getStatsMessageSchema`, normalized by the already-wired
  `RpcAppExceptionFilter`; a `pdfkit`/filesystem failure inside `buildReport` propagates uncaught to the same
  filter, matching `ProcessingLogTracker`'s existing precedent of letting driver/library errors propagate to
  one catch site by design rather than swallowing them.
- **`ReportsController` (service-b) runs under `noAck: false`, so it acks in a `finally` block**, identical
  to Phase 8's `StatsController.handleGetStats` — every `@MessagePattern` handler on `service-b`'s
  microservice must ack itself.
- **`ReportsService`/`ReportsController` are a new top-level `service-b` module (`ReportsModule`), not folded
  into `ProcessingLogModule`** — unlike Phase 8's `stats/` subfolder (which reads the `processing-logs`
  collection directly and therefore belongs inside the module that owns that collection), this phase's
  `reports/` code never touches Mongo/Redis itself; it only calls `ProcessingLogModule`'s exported
  `StatsService`. Per `CLAUDE.md`'s module-boundary rule, a module with no persistence of its own is its own
  thin feature module that consumes another module's exported service — same reasoning the design doc's own
  Phase 9 roadmap sketch already reflects (`back-end/service-b/src/reports/...`, a sibling of
  `processing-log/`, not nested under it). Task 4 adds `exports: [StatsService]` to `ProcessingLogModule` to
  make this legal.
- **The gateway's `ReportsModule` registers its own `SERVICE_B_RMQ_CLIENT`** via `ClientsModule.registerAsync`,
  under its own `reports/rabbitmq-client.token.ts` — the same module-scoped duplication `StatsModule`/
  `LogsModule`/`EventsModule`/`ImportsModule`/`HealthModule` already use (string DI tokens are module-scoped,
  so the identical `'SERVICE_B_RMQ_CLIENT'` string across modules does not collide). Consolidating these is a
  cross-cutting refactor of existing working code, out of scope here — already an accepted trade-off called
  out in Phases 7/8's own plans.
- **`buildReport` creates the report directory if missing** (`mkdir(dirname(reportPath), { recursive: true })`),
  mirroring `download-archive.ts`'s existing `mkdir(options.storageDirectory, { recursive: true })`
  precedent — the default local-dev `./data/reports` path won't exist until first write, exactly like
  `./data/archives` doesn't.
- Zod validates the inbound RMQ message shape (`generate-report-message.schema.ts`); `class-validator`/
  `class-transformer` validate the gateway's HTTP query params (`GetReportQueryDto`) — each service keeps
  using the validation library already established at its own boundary.
- `unicorn/prevent-abbreviations` rejects short names — full words throughout (allowlist:
  `Dto`/`dto`/`req`/`res`/`E2e`/`e2e`, per `eslint.config.mjs`).
- Type-only imports use inline `type` modifiers (a bare default-import exception: `import type PDFDocument
  from 'pdfkit'` — pdfkit's default export used purely for its type has no named member to inline); relative
  imports use explicit `.js` extensions; imports grouped (builtin/external/internal/parent/sibling/index),
  alphabetized ascending case-insensitive, blank line between groups.
- Naming: `interface`s are `PascalCase` prefixed with `I` (`IStatsResult` reused, `IGenerateReportResult`,
  `IGenerateReportDependencies`). `type` aliases are `PascalCase` with no prefix (`PdfDocument`,
  `GenerateReportMessage`). Blank line required before every `return`/`throw` following a statement, and
  before every `if`.
- `vitest` globals (`describe`/`it`/`expect`/`vi`/`beforeAll`/`beforeEach`/`afterAll`/`afterEach`) are
  available without import — do NOT import them in spec files.
- BDD test naming: `it('should X, when Y')`. Coverage thresholds: 90% lines, 90% branches.
- Mocking convention: plain object literal matching only the members under test, cast with
  `as unknown as <RealType>` — never `vi.mock()`. `buildReport`/`ReportsService`'s own specs do **real**
  filesystem I/O against a temp directory (`mkdtempSync`/`rmSync`), matching
  `upload-import.controller.int.spec.ts`'s existing precedent — the local filesystem is not an "external
  service" this repo's testing convention prohibits (that prohibition targets Mongo/Redis/RabbitMQ/HTTP).
- Test-path assertions use `join(...)` (from `node:path`), never a hand-written literal path with `/`
  separators — this repo runs on Windows dev machines, and `node:path`'s `join` uses the platform separator.
- Real UUID-shaped literals in test fixtures: `a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11` (importId),
  reusing Phases 5–8's literal.
- No `git commit` in any step — every checkpoint is written as "stage the files"; the user commits.

---

## Task 1: `service-b` — add `pdfkit`/`@types/pdfkit` dependencies

**Files:**
- Modify: `back-end/service-b/package.json`

**Interfaces:**
- Produces: `pdfkit` (runtime dependency), `@types/pdfkit` (dev dependency) available to every later task in
  this plan.

- [ ] **Step 1: Install the packages**

Run:
```bash
pnpm --filter service-b add pdfkit
pnpm --filter service-b add -D @types/pdfkit
```

Expected: `back-end/service-b/package.json`'s `dependencies` gains a `"pdfkit": "^0.15.x"` entry and
`devDependencies` gains a `"@types/pdfkit": "^0.13.x"` entry (exact resolved patch versions may differ from
what's written here — that's expected); `pnpm-lock.yaml` at the repo root is updated accordingly.

- [ ] **Step 2: Verify the install**

Run: `pnpm --filter service-b exec node -e "console.log(typeof require('pdfkit'))"`
Expected: prints `function` (confirms the package resolves and exports a constructor).

- [ ] **Step 3: Stage the files**

```bash
git add back-end/service-b/package.json pnpm-lock.yaml
```

---

## Task 2: `service-b` — `config/report.config.ts`

**Files:**
- Create: `back-end/service-b/src/config/report.config.ts`
- Create: `back-end/service-b/src/config/report.config.spec.ts`
- Modify: `back-end/service-b/.env.example`

**Interfaces:**
- Produces: `ReportConfiguration { dir: string }`, default `'./data/reports'`, overridable via
  `REPORT_DIR`.
- Consumed by: Task 8 (`ReportsService`), Task 11 (`app.module.ts`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-b/src/config/report.config.spec.ts`:
```ts
import reportConfig from './report.config.js';

describe('reportConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return the documented default, when no environment variable is set', () => {
      delete process.env.REPORT_DIR;

      expect(reportConfig()).toEqual({ dir: './data/reports' });
    });
  });

  describe('environment overrides', () => {
    it('should parse the value from the environment variable, when it is set', () => {
      process.env.REPORT_DIR = '/data/reports';

      expect(reportConfig()).toEqual({ dir: '/data/reports' });
    });
  });

  describe('validation', () => {
    it('should throw, when REPORT_DIR is an empty string', () => {
      process.env.REPORT_DIR = '';

      expect(() => reportConfig()).toThrow();
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- report.config.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `report.config.ts`**

`back-end/service-b/src/config/report.config.ts`:
```ts
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const reportConfigSchema = z.object({
  dir: z.string().min(1).default('./data/reports'),
});

export type ReportConfiguration = z.infer<typeof reportConfigSchema>;

export default registerAs('report', (): ReportConfiguration =>
  reportConfigSchema.parse({
    dir: process.env.REPORT_DIR,
  }),
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- report.config.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Document the new variable**

Modify `back-end/service-b/.env.example` to add, after the `MONGODB_URI` line:
```
REPORT_DIR=./data/reports
```

- [ ] **Step 6: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 7: Stage the files**

```bash
git add back-end/service-b/src/config/report.config.ts back-end/service-b/src/config/report.config.spec.ts back-end/service-b/.env.example
```

---

## Task 3: `service-b` — export `StatsService` from `ProcessingLogModule`

**Files:**
- Modify: `back-end/service-b/src/processing-log/processing-log.module.ts`

**Interfaces:**
- Produces: `StatsService` becomes importable by other `service-b` modules.
- Consumed by: Task 9 (`ReportsModule`).

- [ ] **Step 1: Add the `exports` array**

Modify `back-end/service-b/src/processing-log/processing-log.module.ts` to:
```ts
import { Module } from '@nestjs/common';
import { LoggerModule } from '@task1/shared/logger/rmq/logger.module';

import { EnsureProcessingLogIndexesInitializer } from './ensure-processing-log-indexes-initializer.service.js';
import { ImportEventsController } from './import-events.controller.js';
import { processingLogCollectionProvider } from './processing-log-collection.provider.js';
import { ProcessingLogTracker } from './processing-log-tracker.service.js';
import { LogsSearchController } from './search/logs-search.controller.js';
import { LogsSearchService } from './search/logs-search.service.js';
import { StatsMetricsReader } from './stats/stats-metrics-reader.service.js';
import { StatsController } from './stats/stats.controller.js';
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
  exports: [StatsService],
})
export class ProcessingLogModule {}
```

(Only the trailing `exports: [StatsService],` line is new; every import and every other member is
unchanged.)

- [ ] **Step 2: Run the full `service-b` test suite**

Run: `pnpm --filter service-b test`
Expected: PASS (no existing test exercises `ProcessingLogModule`'s Nest wiring directly, so this is a
no-op for the suite — confirms nothing broke).

- [ ] **Step 3: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 4: Stage the files**

```bash
git add back-end/service-b/src/processing-log/processing-log.module.ts
```

---

## Task 4: `service-b` — `reports/report-path.util.ts`

**Files:**
- Create: `back-end/service-b/src/reports/report-path.util.ts`
- Create: `back-end/service-b/src/reports/report-path.util.spec.ts`

**Interfaces:**
- Produces: `buildReportFilename(importId?: string): string` — pure function. `${importId}.pdf` when given,
  otherwise `${randomUUID()}.pdf`.
- Consumed by: Task 6 (`generate-report.ts`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-b/src/reports/report-path.util.spec.ts`:
```ts
import { buildReportFilename } from './report-path.util.js';

describe('buildReportFilename', () => {
  it('should return "<importId>.pdf", when importId is given', () => {
    const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

    expect(buildReportFilename(importId)).toBe(`${importId}.pdf`);
  });

  it('should return a filename ending in .pdf, when importId is omitted', () => {
    expect(buildReportFilename()).toMatch(/\.pdf$/);
  });

  it('should return a different filename on each call, when importId is omitted', () => {
    expect(buildReportFilename()).not.toBe(buildReportFilename());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- report-path.util.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `report-path.util.ts`**

`back-end/service-b/src/reports/report-path.util.ts`:
```ts
import { randomUUID } from 'node:crypto';

const PDF_EXTENSION = '.pdf';

export function buildReportFilename(importId?: string): string {
  const id = importId ?? randomUUID();

  return `${id}${PDF_EXTENSION}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- report-path.util.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-b/src/reports/report-path.util.ts back-end/service-b/src/reports/report-path.util.spec.ts
```

---

## Task 5: `service-b` — `reports/report-charts.ts` (pdfkit drawing step functions)

**Files:**
- Create: `back-end/service-b/src/reports/report-charts.ts`
- Create: `back-end/service-b/src/reports/report-charts.spec.ts`

**Interfaces:**
- Consumes: `type IStatsResult` (`../processing-log/stats/get-stats.js`), `type IImportTimeSeriesPoint`
  (`../processing-log/stats/derive-import-duration-stats.js`).
- Produces: `type PdfDocument` (`InstanceType<typeof PDFDocument>`), `drawSummarySection(doc: PdfDocument,
  stats: IStatsResult): void`, `drawEventsOverTimeChart(doc: PdfDocument, timeSeries:
  IImportTimeSeriesPoint[]): void`, `drawStatusBreakdownChart(doc: PdfDocument, stats: IStatsResult): void`
  — pure functions, no I/O, each advances `doc.y` past the content it drew.
- Consumed by: Task 7 (`build-report.ts`).

- [ ] **Step 1: Write the failing tests for `drawSummarySection`**

`back-end/service-b/src/reports/report-charts.spec.ts`:
```ts
import { type IStatsResult } from '../processing-log/stats/get-stats.js';

import { drawEventsOverTimeChart, drawStatusBreakdownChart, drawSummarySection } from './report-charts.js';

function buildFakeDoc(extraMethods: string[] = []): Record<string, unknown> {
  const doc: Record<string, unknown> = { x: 50, y: 100 };
  const methods = ['fontSize', 'text', 'moveDown', ...extraMethods];

  methods.forEach((method) => {
    (doc as Record<string, ReturnType<typeof vi.fn>>)[method] = vi.fn().mockReturnValue(doc);
  });

  return doc;
}

describe('drawSummarySection', () => {
  it('should write six summary lines with a millisecond duration, when processingDurationMs is present', () => {
    const doc = buildFakeDoc();
    const stats: IStatsResult = {
      archivesProcessed: 3,
      eventsProcessed: 300,
      successfulEvents: 290,
      invalidEvents: 10,
      errors: 2,
      processingDurationMs: 15_000,
      timeSeries: [],
    };

    drawSummarySection(doc as never, stats);

    expect(doc.text).toHaveBeenCalledWith('Archives processed: 3');
    expect(doc.text).toHaveBeenCalledWith('Events processed: 300');
    expect(doc.text).toHaveBeenCalledWith('Successful events: 290');
    expect(doc.text).toHaveBeenCalledWith('Invalid events: 10');
    expect(doc.text).toHaveBeenCalledWith('Errors: 2');
    expect(doc.text).toHaveBeenCalledWith('Processing duration: 15000 ms');
  });

  it('should write "n/a" for the duration line, when processingDurationMs is undefined', () => {
    const doc = buildFakeDoc();
    const stats: IStatsResult = {
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 0,
      timeSeries: [],
    };

    drawSummarySection(doc as never, stats);

    expect(doc.text).toHaveBeenCalledWith('Processing duration: n/a');
  });
});

describe('drawEventsOverTimeChart', () => {
  it('should write a "not enough data" message and draw no lines, when the series is empty', () => {
    const doc = buildFakeDoc(['moveTo', 'lineTo', 'stroke']);

    drawEventsOverTimeChart(doc as never, []);

    expect(doc.text).toHaveBeenCalledWith('Not enough data points to draw a chart.');
    expect(doc.moveTo).not.toHaveBeenCalled();
  });

  it('should write a "not enough data" message and draw no lines, when only one point is given', () => {
    const doc = buildFakeDoc(['moveTo', 'lineTo', 'stroke']);

    drawEventsOverTimeChart(doc as never, [{ timestamp: '2026-08-11T00:00:00.000Z', value: 10 }]);

    expect(doc.text).toHaveBeenCalledWith('Not enough data points to draw a chart.');
    expect(doc.moveTo).not.toHaveBeenCalled();
  });

  it('should draw one axis line and one polyline, when 3 points are given', () => {
    const doc = buildFakeDoc(['moveTo', 'lineTo', 'stroke']);
    const timeSeries = [
      { timestamp: '2026-08-11T00:00:00.000Z', value: 10 },
      { timestamp: '2026-08-11T00:01:00.000Z', value: 20 },
      { timestamp: '2026-08-11T00:02:00.000Z', value: 5 },
    ];

    drawEventsOverTimeChart(doc as never, timeSeries);

    expect(doc.moveTo).toHaveBeenCalledTimes(2);
    expect(doc.lineTo).toHaveBeenCalledTimes(3);
    expect(doc.stroke).toHaveBeenCalledTimes(2);
  });

  it('should advance doc.y below the fixed-height chart area, when points are drawn', () => {
    const doc = buildFakeDoc(['moveTo', 'lineTo', 'stroke']);

    drawEventsOverTimeChart(doc as never, [
      { timestamp: '2026-08-11T00:00:00.000Z', value: 10 },
      { timestamp: '2026-08-11T00:01:00.000Z', value: 20 },
    ]);

    expect(doc.y).toBe(100 + 120 + 20);
  });
});

describe('drawStatusBreakdownChart', () => {
  it('should draw 3 bars filled with their status colors, when called', () => {
    const doc = buildFakeDoc(['rect', 'fill', 'fillColor']);
    const stats: IStatsResult = {
      archivesProcessed: 1,
      eventsProcessed: 100,
      successfulEvents: 80,
      invalidEvents: 15,
      errors: 5,
      timeSeries: [],
    };

    drawStatusBreakdownChart(doc as never, stats);

    expect(doc.rect).toHaveBeenCalledTimes(3);
    expect(doc.fill).toHaveBeenCalledWith('#2E7D32');
    expect(doc.fill).toHaveBeenCalledWith('#F9A825');
    expect(doc.fill).toHaveBeenCalledWith('#C62828');
  });

  it('should draw a zero-height bar, when a counter is zero', () => {
    const doc = buildFakeDoc(['rect', 'fill', 'fillColor']);
    const stats: IStatsResult = {
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 0,
      timeSeries: [],
    };

    drawStatusBreakdownChart(doc as never, stats);

    expect(doc.rect).toHaveBeenCalledWith(50, 100 + 120, 60, 0);
  });

  it('should advance doc.y below the fixed-height chart area, when called', () => {
    const doc = buildFakeDoc(['rect', 'fill', 'fillColor']);
    const stats: IStatsResult = {
      archivesProcessed: 1,
      eventsProcessed: 1,
      successfulEvents: 1,
      invalidEvents: 0,
      errors: 0,
      timeSeries: [],
    };

    drawStatusBreakdownChart(doc as never, stats);

    expect(doc.y).toBe(100 + 120 + 25);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter service-b test -- report-charts.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `report-charts.ts`**

`back-end/service-b/src/reports/report-charts.ts`:
```ts
import type PDFDocument from 'pdfkit';

import { type IImportTimeSeriesPoint } from '../processing-log/stats/derive-import-duration-stats.js';
import { type IStatsResult } from '../processing-log/stats/get-stats.js';

export type PdfDocument = InstanceType<typeof PDFDocument>;

const TIME_CHART_WIDTH = 400;
const TIME_CHART_HEIGHT = 120;
const TIME_CHART_BOTTOM_MARGIN = 20;

const BAR_CHART_HEIGHT = 120;
const BAR_WIDTH = 60;
const BAR_GAP = 40;
const BAR_CHART_BOTTOM_MARGIN = 25;
const SUCCESSFUL_BAR_COLOR = '#2E7D32';
const INVALID_BAR_COLOR = '#F9A825';
const ERROR_BAR_COLOR = '#C62828';

interface IBreakdownBar {
  label: string;
  value: number;
  color: string;
}

export function drawSummarySection(doc: PdfDocument, stats: IStatsResult): void {
  doc.fontSize(14).text('Summary', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(11);
  doc.text(`Archives processed: ${stats.archivesProcessed}`);
  doc.text(`Events processed: ${stats.eventsProcessed}`);
  doc.text(`Successful events: ${stats.successfulEvents}`);
  doc.text(`Invalid events: ${stats.invalidEvents}`);
  doc.text(`Errors: ${stats.errors}`);
  doc.text(
    stats.processingDurationMs === undefined
      ? 'Processing duration: n/a'
      : `Processing duration: ${stats.processingDurationMs} ms`,
  );
}

export function drawEventsOverTimeChart(doc: PdfDocument, timeSeries: IImportTimeSeriesPoint[]): void {
  doc.fontSize(14).text('Events Processed Over Time', { underline: true });
  doc.moveDown(0.5);

  if (timeSeries.length < 2) {
    doc.fontSize(11).text('Not enough data points to draw a chart.');

    return;
  }

  const originX = doc.x;
  const originY = doc.y;
  const maxValue = Math.max(...timeSeries.map((point) => point.value), 1);
  const stepX = TIME_CHART_WIDTH / (timeSeries.length - 1);

  doc
    .moveTo(originX, originY + TIME_CHART_HEIGHT)
    .lineTo(originX + TIME_CHART_WIDTH, originY + TIME_CHART_HEIGHT)
    .stroke();

  timeSeries.forEach((point, index) => {
    const x = originX + index * stepX;
    const y = originY + TIME_CHART_HEIGHT - (point.value / maxValue) * TIME_CHART_HEIGHT;

    if (index === 0) {
      doc.moveTo(x, y);

      return;
    }

    doc.lineTo(x, y);
  });

  doc.stroke();

  doc.y = originY + TIME_CHART_HEIGHT + TIME_CHART_BOTTOM_MARGIN;
}

export function drawStatusBreakdownChart(doc: PdfDocument, stats: IStatsResult): void {
  doc.fontSize(14).text('Event Outcome Breakdown', { underline: true });
  doc.moveDown(0.5);

  const originX = doc.x;
  const originY = doc.y;
  const bars: IBreakdownBar[] = [
    { label: 'Successful', value: stats.successfulEvents, color: SUCCESSFUL_BAR_COLOR },
    { label: 'Invalid', value: stats.invalidEvents, color: INVALID_BAR_COLOR },
    { label: 'Errors', value: stats.errors, color: ERROR_BAR_COLOR },
  ];
  const maxValue = Math.max(...bars.map((bar) => bar.value), 1);

  bars.forEach((bar, index) => {
    const barHeight = (bar.value / maxValue) * BAR_CHART_HEIGHT;
    const x = originX + index * (BAR_WIDTH + BAR_GAP);
    const y = originY + BAR_CHART_HEIGHT - barHeight;

    doc.rect(x, y, BAR_WIDTH, barHeight).fill(bar.color);
    doc
      .fillColor('black')
      .fontSize(9)
      .text(`${bar.label}: ${bar.value}`, x, originY + BAR_CHART_HEIGHT + 5, {
        width: BAR_WIDTH + BAR_GAP,
      });
  });

  doc.y = originY + BAR_CHART_HEIGHT + BAR_CHART_BOTTOM_MARGIN;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter service-b test -- report-charts.spec.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-b/src/reports/report-charts.ts back-end/service-b/src/reports/report-charts.spec.ts
```

---

## Task 6: `service-b` — `reports/build-report.ts`

**Files:**
- Create: `back-end/service-b/src/reports/build-report.ts`
- Create: `back-end/service-b/src/reports/build-report.spec.ts`

**Interfaces:**
- Consumes: `type IStatsResult` (`../processing-log/stats/get-stats.js`), `drawEventsOverTimeChart`/
  `drawStatusBreakdownChart`/`drawSummarySection` (Task 5).
- Produces: `buildReport(stats: IStatsResult, reportPath: string): Promise<void>` — creates the report
  directory if missing, streams a pdfkit-generated PDF to `reportPath`, resolves once the write stream
  emits `'finish'`.
- Consumed by: Task 8 (`ReportsService`).

- [ ] **Step 1: Write the failing tests**

`back-end/service-b/src/reports/build-report.spec.ts`:
```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type IStatsResult } from '../processing-log/stats/get-stats.js';

import { buildReport } from './build-report.js';

describe('buildReport', () => {
  let reportDirectory: string;

  beforeEach(() => {
    reportDirectory = mkdtempSync(join(tmpdir(), 'build-report-spec-'));
  });

  afterEach(() => {
    rmSync(reportDirectory, { recursive: true, force: true });
  });

  it('should write a valid PDF file to reportPath, when called with populated stats', async () => {
    const reportPath = join(reportDirectory, 'report.pdf');
    const stats: IStatsResult = {
      archivesProcessed: 3,
      eventsProcessed: 300,
      successfulEvents: 290,
      invalidEvents: 10,
      errors: 2,
      processingDurationMs: 15_000,
      timeSeries: [
        { timestamp: '2026-08-11T00:00:00.000Z', value: 100 },
        { timestamp: '2026-08-11T00:05:00.000Z', value: 200 },
      ],
    };

    await buildReport(stats, reportPath);

    const bytes = readFileSync(reportPath);

    expect(bytes.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('should write a valid PDF file, when timeSeries is empty and processingDurationMs is undefined', async () => {
    const reportPath = join(reportDirectory, 'empty-report.pdf');
    const stats: IStatsResult = {
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 0,
      timeSeries: [],
    };

    await buildReport(stats, reportPath);

    const bytes = readFileSync(reportPath);

    expect(bytes.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('should create the report directory, when it does not yet exist', async () => {
    const nestedDirectory = join(reportDirectory, 'nested');
    const reportPath = join(nestedDirectory, 'report.pdf');
    const stats: IStatsResult = {
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 0,
      timeSeries: [],
    };

    await buildReport(stats, reportPath);

    const bytes = readFileSync(reportPath);

    expect(bytes.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter service-b test -- build-report.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `build-report.ts`**

`back-end/service-b/src/reports/build-report.ts`:
```ts
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import PDFDocument from 'pdfkit';

import { type IStatsResult } from '../processing-log/stats/get-stats.js';

import { drawEventsOverTimeChart, drawStatusBreakdownChart, drawSummarySection } from './report-charts.js';

export async function buildReport(stats: IStatsResult, reportPath: string): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- reportPath is built from the configured report directory and a server-generated id, never raw external input.
  await mkdir(dirname(reportPath), { recursive: true });

  const doc = new PDFDocument({ margin: 50 });

  await new Promise<void>((resolve, reject) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
    const writeStream = createWriteStream(reportPath);

    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
    doc.on('error', reject);

    doc.pipe(writeStream);

    doc.fontSize(20).text('GitHub Archive Processing Report', { align: 'center' });
    doc.moveDown();

    drawSummarySection(doc, stats);
    doc.moveDown();
    drawEventsOverTimeChart(doc, stats.timeSeries);
    doc.moveDown();
    drawStatusBreakdownChart(doc, stats);

    doc.end();
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter service-b test -- build-report.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-b/src/reports/build-report.ts back-end/service-b/src/reports/build-report.spec.ts
```

---

## Task 7: `service-b` — `generate-report-message.schema.ts` + `generate-report.ts`

**Files:**
- Create: `back-end/service-b/src/reports/generate-report-message.schema.ts`
- Create: `back-end/service-b/src/reports/generate-report-message.schema.spec.ts`
- Create: `back-end/service-b/src/reports/generate-report.ts`
- Create: `back-end/service-b/src/reports/generate-report.spec.ts`

**Interfaces:**
- Consumes: `buildReportFilename` (Task 4), `type IStatsResult` (`../processing-log/stats/get-stats.js`).
- Produces: `generateReportMessageSchema` (Zod), `type GenerateReportMessage = { importId?: string }`;
  `IGenerateReportResult { reportPath: string }`, `IGenerateReportDependencies { getStats: (importId?:
  string) => Promise<IStatsResult>; buildReport: (stats: IStatsResult, reportPath: string) => Promise<void>
  }`, `generateReport(reportDirectory: string, dependencies: IGenerateReportDependencies, importId?:
  string): Promise<IGenerateReportResult>` — orchestration function, dependency-injected the same way
  `import-archive.ts`'s `IImportArchiveDependencies` already is in this repo.
- Consumed by: Task 8 (`ReportsService`), Task 9 (`ReportsController`).

- [ ] **Step 1: Write the failing tests for the message schema**

`back-end/service-b/src/reports/generate-report-message.schema.spec.ts`:
```ts
import { generateReportMessageSchema } from './generate-report-message.schema.js';

describe('generateReportMessageSchema', () => {
  it('should parse successfully with importId undefined, when no importId is provided', () => {
    expect(generateReportMessageSchema.parse({})).toEqual({ importId: undefined });
  });

  it('should parse successfully, when importId is a valid uuid', () => {
    const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

    expect(generateReportMessageSchema.parse({ importId })).toEqual({ importId });
  });

  it('should throw, when importId is not a uuid', () => {
    expect(() => generateReportMessageSchema.parse({ importId: 'not-a-uuid' })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- generate-report-message.schema.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `generate-report-message.schema.ts`**

`back-end/service-b/src/reports/generate-report-message.schema.ts`:
```ts
import { z } from 'zod';

export const generateReportMessageSchema = z.object({
  importId: z.uuid().optional(),
});

export type GenerateReportMessage = z.infer<typeof generateReportMessageSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- generate-report-message.schema.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing tests for `generateReport`**

`back-end/service-b/src/reports/generate-report.spec.ts`:
```ts
import { join } from 'node:path';

import { type IStatsResult } from '../processing-log/stats/get-stats.js';

import { generateReport } from './generate-report.js';

describe('generateReport', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const stats: IStatsResult = {
    archivesProcessed: 1,
    eventsProcessed: 1,
    successfulEvents: 1,
    invalidEvents: 0,
    errors: 0,
    timeSeries: [],
  };

  it('should build the report at a path derived from the report directory and importId, when importId is given', async () => {
    const getStats = vi.fn().mockResolvedValue(stats);
    const buildReportMock = vi.fn().mockResolvedValue(undefined);
    const expectedPath = join('/data/reports', `${importId}.pdf`);

    const result = await generateReport(
      '/data/reports',
      { getStats, buildReport: buildReportMock },
      importId,
    );

    expect(getStats).toHaveBeenCalledWith(importId);
    expect(buildReportMock).toHaveBeenCalledWith(stats, expectedPath);
    expect(result).toEqual({ reportPath: expectedPath });
  });

  it('should derive a random .pdf filename inside the report directory, when importId is omitted', async () => {
    const getStats = vi.fn().mockResolvedValue(stats);
    const buildReportMock = vi.fn().mockResolvedValue(undefined);

    const result = await generateReport('/data/reports', { getStats, buildReport: buildReportMock });

    expect(getStats).toHaveBeenCalledWith(undefined);
    expect(result.reportPath.startsWith(join('/data/reports'))).toBe(true);
    expect(result.reportPath.endsWith('.pdf')).toBe(true);
  });

  it('should propagate the error and never call buildReport, when getStats rejects', async () => {
    const getStats = vi.fn().mockRejectedValue(new Error('mongo unavailable'));
    const buildReportMock = vi.fn();

    await expect(
      generateReport('/data/reports', { getStats, buildReport: buildReportMock }, importId),
    ).rejects.toThrow('mongo unavailable');
    expect(buildReportMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `pnpm --filter service-b test -- generate-report.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `generate-report.ts`**

`back-end/service-b/src/reports/generate-report.ts`:
```ts
import { join } from 'node:path';

import { type IStatsResult } from '../processing-log/stats/get-stats.js';

import { buildReportFilename } from './report-path.util.js';

export interface IGenerateReportResult {
  reportPath: string;
}

export interface IGenerateReportDependencies {
  getStats: (importId?: string) => Promise<IStatsResult>;
  buildReport: (stats: IStatsResult, reportPath: string) => Promise<void>;
}

export async function generateReport(
  reportDirectory: string,
  dependencies: IGenerateReportDependencies,
  importId?: string,
): Promise<IGenerateReportResult> {
  const stats = await dependencies.getStats(importId);
  const reportPath = join(reportDirectory, buildReportFilename(importId));

  await dependencies.buildReport(stats, reportPath);

  return { reportPath };
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter service-b test -- generate-report.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 10: Stage the files**

```bash
git add back-end/service-b/src/reports/generate-report-message.schema.ts back-end/service-b/src/reports/generate-report-message.schema.spec.ts back-end/service-b/src/reports/generate-report.ts back-end/service-b/src/reports/generate-report.spec.ts
```

---

## Task 8: `service-b` — `ReportsService`

**Files:**
- Create: `back-end/service-b/src/reports/reports.service.ts`
- Create: `back-end/service-b/src/reports/reports.service.spec.ts`

**Interfaces:**
- Consumes: `StatsService` (Task 3 export), `reportConfig`/`type ReportConfiguration` (Task 2),
  `buildReport` (Task 6), `generateReport`/`type IGenerateReportResult` (Task 7).
- Produces: `ReportsService.generateReport(importId?: string): Promise<IGenerateReportResult>`.
- Consumed by: Task 9 (`ReportsController`), Task 10 (`ReportsModule`).

- [ ] **Step 1: Write the failing test**

`back-end/service-b/src/reports/reports.service.spec.ts`:
```ts
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type ReportConfiguration } from '../config/report.config.js';
import { type StatsService } from '../processing-log/stats/stats.service.js';

import { ReportsService } from './reports.service.js';

describe('ReportsService', () => {
  let reportDirectory: string;

  beforeEach(() => {
    reportDirectory = mkdtempSync(join(tmpdir(), 'reports-service-spec-'));
  });

  afterEach(() => {
    rmSync(reportDirectory, { recursive: true, force: true });
  });

  it('should generate a PDF report using the injected stats service and configured report directory, when generateReport is called', async () => {
    const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const getStats = vi.fn().mockResolvedValue({
      archivesProcessed: 1,
      eventsProcessed: 10,
      successfulEvents: 9,
      invalidEvents: 1,
      errors: 0,
      timeSeries: [],
    });
    const statsService = { getStats } as unknown as StatsService;
    const reportConfiguration: ReportConfiguration = { dir: reportDirectory };
    const service = new ReportsService(statsService, reportConfiguration);

    const result = await service.generateReport(importId);

    expect(getStats).toHaveBeenCalledWith(importId);
    expect(result.reportPath).toBe(join(reportDirectory, `${importId}.pdf`));
    expect(existsSync(result.reportPath)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter service-b test -- reports.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `reports.service.ts`**

`back-end/service-b/src/reports/reports.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';

import reportConfig, { type ReportConfiguration } from '../config/report.config.js';
import { StatsService } from '../processing-log/stats/stats.service.js';

import { buildReport } from './build-report.js';
import { generateReport, type IGenerateReportResult } from './generate-report.js';

@Injectable()
export class ReportsService {
  public constructor(
    private readonly statsService: StatsService,
    @Inject(reportConfig.KEY) private readonly reportConfiguration: ReportConfiguration,
  ) {}

  public generateReport(importId?: string): Promise<IGenerateReportResult> {
    return generateReport(
      this.reportConfiguration.dir,
      {
        getStats: (id) => this.statsService.getStats(id),
        buildReport,
      },
      importId,
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter service-b test -- reports.service.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-b/src/reports/reports.service.ts back-end/service-b/src/reports/reports.service.spec.ts
```

---

## Task 9: `service-b` — `ReportsController`

**Files:**
- Create: `back-end/service-b/src/reports/reports.controller.ts`
- Create: `back-end/service-b/src/reports/reports.controller.spec.ts`

**Interfaces:**
- Consumes: `generateReportMessageSchema` (Task 7), `type IGenerateReportResult` (Task 7), `ReportsService`
  (Task 8).
- Produces: `ReportsController` — `@MessagePattern('reports.pdf.generate')`, request/reply, acks in a
  `finally` (Global Constraints, same as `StatsController`).
- Consumed by: Task 10 (`ReportsModule`), gateway's `ReportsController` (Task 15) via
  `ClientProxy.send('reports.pdf.generate', ...)`.

- [ ] **Step 1: Write the failing tests**

`back-end/service-b/src/reports/reports.controller.spec.ts`:
```ts
import { type RmqContext } from '@nestjs/microservices';

import { ReportsController } from './reports.controller.js';
import { type ReportsService } from './reports.service.js';

describe('ReportsController', () => {
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

  it('should validate the payload, delegate to ReportsService, and ack, when a valid message is received', async () => {
    const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const generateReportResult = { reportPath: '/data/reports/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.pdf' };
    const generateReport = vi.fn().mockResolvedValue(generateReportResult);
    const reportsService = { generateReport } as unknown as ReportsService;
    const controller = new ReportsController(reportsService);
    const { context, message, ack } = buildContext();

    const result = await controller.handleGenerateReport({ importId }, context);

    expect(result).toBe(generateReportResult);
    expect(generateReport).toHaveBeenCalledWith(importId);
    expect(ack).toHaveBeenCalledWith(message);
  });

  it('should reject but still ack, when the payload fails schema validation', async () => {
    const generateReport = vi.fn();
    const reportsService = { generateReport } as unknown as ReportsService;
    const controller = new ReportsController(reportsService);
    const { context, message, ack } = buildContext();

    await expect(controller.handleGenerateReport({ importId: 'not-a-uuid' }, context)).rejects.toThrow();
    expect(generateReport).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith(message);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter service-b test -- reports.controller.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `reports.controller.ts`**

`back-end/service-b/src/reports/reports.controller.ts`:
```ts
import { Controller } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, type RmqContext } from '@nestjs/microservices';

import { generateReportMessageSchema } from './generate-report-message.schema.js';
import { type IGenerateReportResult } from './generate-report.js';
import { ReportsService } from './reports.service.js';

@Controller()
export class ReportsController {
  public constructor(private readonly reportsService: ReportsService) {}

  @MessagePattern('reports.pdf.generate')
  public async handleGenerateReport(
    @Payload() payload: unknown,
    @Ctx() context: RmqContext,
  ): Promise<IGenerateReportResult> {
    try {
      const message = generateReportMessageSchema.parse(payload);

      return await this.reportsService.generateReport(message.importId);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- RmqContext channel is loosely typed; matches HealthController's manual-ack precedent under noAck: false
      context.getChannelRef().ack(context.getMessage());
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter service-b test -- reports.controller.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-b/src/reports/reports.controller.ts back-end/service-b/src/reports/reports.controller.spec.ts
```

---

## Task 10: `service-b` — `ReportsModule` + wire into `app.module.ts`

**Files:**
- Create: `back-end/service-b/src/reports/reports.module.ts`
- Modify: `back-end/service-b/src/app.module.ts`

**Interfaces:**
- Consumes: `ProcessingLogModule` (Task 3 export), `ReportsController` (Task 9), `ReportsService` (Task 8),
  `reportConfig` (Task 2).
- Produces: `ReportsModule` registered in `AppModule`.

- [ ] **Step 1: Implement `reports.module.ts`**

`back-end/service-b/src/reports/reports.module.ts`:
```ts
import { Module } from '@nestjs/common';

import { ProcessingLogModule } from '../processing-log/processing-log.module.js';

import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [ProcessingLogModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
```

- [ ] **Step 2: Wire `reportConfig` and `ReportsModule` into `app.module.ts`**

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
import reportConfig from './config/report.config.js';
import { HealthModule } from './health/health.module.js';
import { MongoModule } from './infra/mongo/mongo.module.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { ProcessingLogModule } from './processing-log/processing-log.module.js';
import { ReportsModule } from './reports/reports.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [loggerConfig, rabbitmqConfig, mongodbConfig, redisConfig, reportConfig],
    }),
    RequestContextModule,
    LoggerModule,
    ExceptionHandlingModule,
    MongoModule,
    RedisModule,
    HealthModule,
    ProcessingLogModule,
    ReportsModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 3: Run the full `service-b` test suite**

Run: `pnpm --filter service-b test`
Expected: PASS (every test from Tasks 1–9 plus the pre-existing suite).

- [ ] **Step 4: Lint**

Run: `pnpm --filter service-b lint`
Expected: PASS.

- [ ] **Step 5: Build**

Run: `pnpm --filter service-b build`
Expected: PASS (confirms `pdfkit`'s types resolve cleanly under `nest build`).

- [ ] **Step 6: Stage the files**

```bash
git add back-end/service-b/src/reports/reports.module.ts back-end/service-b/src/app.module.ts
```

---

## Task 11: `api-gateway` — `config/report.config.ts`

**Files:**
- Create: `back-end/api-gateway/src/config/report.config.ts`
- Create: `back-end/api-gateway/src/config/report.config.spec.ts`
- Modify: `back-end/api-gateway/.env.example`

**Interfaces:**
- Produces: `ReportConfiguration { dir: string }`, default `'./data/reports'`, overridable via
  `REPORT_DIR` — same shape and default as `service-b`'s (Task 2), since both mount the same shared
  `report-storage` volume at the same path.
- Consumed by: Task 14 (gateway `ReportsController`), Task 16 (`app.module.ts`).

- [ ] **Step 1: Write the failing tests**

`back-end/api-gateway/src/config/report.config.spec.ts`:
```ts
import reportConfig from './report.config.js';

describe('reportConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('defaults', () => {
    it('should return the documented default, when no environment variable is set', () => {
      delete process.env.REPORT_DIR;

      expect(reportConfig()).toEqual({ dir: './data/reports' });
    });
  });

  describe('environment overrides', () => {
    it('should parse the value from the environment variable, when it is set', () => {
      process.env.REPORT_DIR = '/data/reports';

      expect(reportConfig()).toEqual({ dir: '/data/reports' });
    });
  });

  describe('validation', () => {
    it('should throw, when REPORT_DIR is an empty string', () => {
      process.env.REPORT_DIR = '';

      expect(() => reportConfig()).toThrow();
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter api-gateway test -- report.config.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `report.config.ts`**

`back-end/api-gateway/src/config/report.config.ts`:
```ts
import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const reportConfigSchema = z.object({
  dir: z.string().min(1).default('./data/reports'),
});

export type ReportConfiguration = z.infer<typeof reportConfigSchema>;

export default registerAs('report', (): ReportConfiguration =>
  reportConfigSchema.parse({
    dir: process.env.REPORT_DIR,
  }),
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter api-gateway test -- report.config.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Document the new variable**

Modify `back-end/api-gateway/.env.example` to add, after the `STORAGE_DIR`/`UPLOAD_MAX_FILE_SIZE_BYTES`
lines:
```
REPORT_DIR=./data/reports
```

- [ ] **Step 6: Lint**

Run: `pnpm --filter api-gateway lint`
Expected: PASS.

- [ ] **Step 7: Stage the files**

```bash
git add back-end/api-gateway/src/config/report.config.ts back-end/api-gateway/src/config/report.config.spec.ts back-end/api-gateway/.env.example
```

---

## Task 12: infra — `report-storage` Docker volume

**Files:**
- Modify: `docker-compose.yml`

**Interfaces:**
- Produces: a `report-storage` named volume, mounted at `/data/reports` in both `service-b` and
  `api-gateway`, with `REPORT_DIR=/data/reports` set as an environment variable in both — the shared-volume
  half of Finding 1.

- [ ] **Step 1: Add `REPORT_DIR` and the volume mount to `service-b`**

Modify `docker-compose.yml`'s `service-b` block to:
```yaml
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
      REPORT_DIR: /data/reports
    volumes:
      - report-storage:/data/reports
    depends_on:
      rabbitmq:
        condition: service_healthy
      mongodb:
        condition: service_healthy
      redis:
        condition: service_healthy
```

- [ ] **Step 2: Add `REPORT_DIR` and the volume mount to `api-gateway`**

Modify `docker-compose.yml`'s `api-gateway` block to:
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
      REPORT_DIR: /data/reports
    volumes:
      - archive-storage:/data/archives
      - report-storage:/data/reports
    depends_on:
      rabbitmq:
        condition: service_healthy
      mongodb:
        condition: service_healthy
      redis:
        condition: service_healthy
```

- [ ] **Step 3: Declare the named volume**

Modify `docker-compose.yml`'s top-level `volumes:` block to:
```yaml
volumes:
  archive-storage:
  report-storage:
```

- [ ] **Step 4: Validate the compose file**

Run: `docker compose config --quiet`
Expected: exits with no output (confirms valid YAML and no interpolation errors).

- [ ] **Step 5: Stage the files**

```bash
git add docker-compose.yml
```

---

## Task 13: `api-gateway` — `reports/rabbitmq-client.token.ts` + `reports/dto/get-report-query.dto.ts`

**Files:**
- Create: `back-end/api-gateway/src/reports/rabbitmq-client.token.ts`
- Create: `back-end/api-gateway/src/reports/dto/get-report-query.dto.ts`
- Create: `back-end/api-gateway/src/reports/dto/get-report-query.dto.spec.ts`

**Interfaces:**
- Produces: `SERVICE_B_RMQ_CLIENT = 'SERVICE_B_RMQ_CLIENT'`, `GetReportQueryDto { importId?: string }`
  (class-validator, mirrors `GetStatsQueryDto`).
- Consumed by: Task 14 (`ReportsController`), Task 15 (`ReportsModule`).

- [ ] **Step 1: Implement `rabbitmq-client.token.ts`**

`back-end/api-gateway/src/reports/rabbitmq-client.token.ts`:
```ts
export const SERVICE_B_RMQ_CLIENT = 'SERVICE_B_RMQ_CLIENT';
```

- [ ] **Step 2: Write the failing tests for `GetReportQueryDto`**

`back-end/api-gateway/src/reports/dto/get-report-query.dto.spec.ts`:
```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { GetReportQueryDto } from './get-report-query.dto.js';

describe('GetReportQueryDto', () => {
  it('should produce no validation errors, when importId is omitted', async () => {
    const dto = plainToInstance(GetReportQueryDto, {});

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.importId).toBeUndefined();
  });

  it('should produce no validation errors, when importId is a valid uuid', async () => {
    const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const dto = plainToInstance(GetReportQueryDto, { importId });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.importId).toBe(importId);
  });

  it('should produce a validation error, when importId is not a uuid', async () => {
    const dto = plainToInstance(GetReportQueryDto, { importId: 'not-a-uuid' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter api-gateway test -- get-report-query.dto.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `get-report-query.dto.ts`**

`back-end/api-gateway/src/reports/dto/get-report-query.dto.ts`:
```ts
import { IsOptional, IsUUID } from 'class-validator';

export class GetReportQueryDto {
  @IsOptional()
  @IsUUID()
  public readonly importId?: string;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter api-gateway test -- get-report-query.dto.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Lint**

Run: `pnpm --filter api-gateway lint`
Expected: PASS.

- [ ] **Step 7: Stage the files**

```bash
git add back-end/api-gateway/src/reports/rabbitmq-client.token.ts back-end/api-gateway/src/reports/dto/get-report-query.dto.ts back-end/api-gateway/src/reports/dto/get-report-query.dto.spec.ts
```

---

## Task 14: `api-gateway` — `ReportsController` (streams the PDF back)

**Files:**
- Create: `back-end/api-gateway/src/reports/reports.controller.ts`

**Interfaces:**
- Consumes: `SERVICE_B_RMQ_CLIENT` (Task 13), `GetReportQueryDto` (Task 13), `rabbitmqConfig` (existing),
  `RequestContextService`/`buildOutboundHeaders` (existing, same as `StatsController`).
- Produces: `ReportsController` — `GET /reports/pdf`, RPCs service-b for `{ reportPath }`, streams that file
  back as a `StreamableFile`, deletes it once the response finishes.
- Consumed by: Task 15 (`ReportsModule`).

- [ ] **Step 1: Implement `reports.controller.ts`**

`back-end/api-gateway/src/reports/reports.controller.ts`:
```ts
import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';

import { Controller, Get, Inject, Query, Res, StreamableFile } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import { buildOutboundHeaders } from '@task1/shared/request-context/propagation.util';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { type Response } from 'express';
import { firstValueFrom, timeout } from 'rxjs';

import rabbitmqConfig from '../config/rabbitmq.config.js';

import { GetReportQueryDto } from './dto/get-report-query.dto.js';
import { SERVICE_B_RMQ_CLIENT } from './rabbitmq-client.token.js';

const REPORTS_PDF_GENERATE_PATTERN = 'reports.pdf.generate';

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- deliberately a `type`, not an `I`-prefixed `interface`, matching the RMQ reply shape of `IGenerateReportResult`
type GenerateReportRpcResult = { reportPath: string };

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  public constructor(
    @Inject(SERVICE_B_RMQ_CLIENT) private readonly serviceBClient: ClientProxy,
    private readonly requestContextService: RequestContextService,
    @Inject(rabbitmqConfig.KEY)
    private readonly rabbitmqConfiguration: ConfigType<typeof rabbitmqConfig>,
  ) {}

  @Get('pdf')
  @ApiOperation({
    summary: 'Generate and download a PDF processing report, optionally scoped to one import',
  })
  @ApiQuery({ name: 'importId', required: false, description: 'Import run UUID' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ description: 'The generated PDF report' })
  public async getPdfReport(
    @Query() query: GetReportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const headers = buildOutboundHeaders(this.requestContextService.requireContext());
    const record = new RmqRecordBuilder(query).setOptions({ headers }).build();

    const result = await firstValueFrom(
      this.serviceBClient
        .send<GenerateReportRpcResult>(REPORTS_PDF_GENERATE_PATTERN, record)
        .pipe(timeout(this.rabbitmqConfiguration.rpcTimeoutMs)),
    );

    response.on('finish', () => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- result.reportPath is the path service-b just reported having written inside the shared report-storage volume, not raw external input.
      unlink(result.reportPath).catch(() => undefined);
    });

    return new StreamableFile(
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
      createReadStream(result.reportPath),
      {
        type: 'application/pdf',
        disposition: `attachment; filename="report-${query.importId ?? 'aggregate'}.pdf"`,
      },
    );
  }
}
```

(No standalone `.spec.ts` for this controller — matching `StatsController`/`EventsController`'s existing
precedent of testing gateway HTTP controllers only via `.int.spec.ts`, added in Task 17.)

- [ ] **Step 2: Lint**

Run: `pnpm --filter api-gateway lint`
Expected: PASS.

- [ ] **Step 3: Stage the files**

```bash
git add back-end/api-gateway/src/reports/reports.controller.ts
```

---

## Task 15: `api-gateway` — `ReportsModule` + wire into `app.module.ts`

**Files:**
- Create: `back-end/api-gateway/src/reports/reports.module.ts`
- Modify: `back-end/api-gateway/src/app.module.ts`

**Interfaces:**
- Consumes: `SERVICE_B_RMQ_CLIENT` (Task 13), `ReportsController` (Task 14), `rabbitmqConfig`/`reportConfig`
  (existing/Task 11).
- Produces: `ReportsModule` registered in `AppModule`.

- [ ] **Step 1: Implement `reports.module.ts`**

`back-end/api-gateway/src/reports/reports.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';

import rabbitmqConfig from '../config/rabbitmq.config.js';

import { SERVICE_B_RMQ_CLIENT } from './rabbitmq-client.token.js';
import { ReportsController } from './reports.controller.js';

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
  controllers: [ReportsController],
})
export class ReportsModule {}
```

- [ ] **Step 2: Wire `reportConfig` and `ReportsModule` into `app.module.ts`**

Modify `back-end/api-gateway/src/app.module.ts` to:
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
import reportConfig from './config/report.config.js';
import storageConfig from './config/storage.config.js';
import uploadConfig from './config/upload.config.js';
import { EventsModule } from './events/events.module.js';
import { HealthModule } from './health/health.module.js';
import { ImportsModule } from './imports/imports.module.js';
import { ReportsModule } from './reports/reports.module.js';
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
        reportConfig,
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
    ReportsModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 3: Lint**

Run: `pnpm --filter api-gateway lint`
Expected: PASS.

- [ ] **Step 4: Stage the files**

```bash
git add back-end/api-gateway/src/reports/reports.module.ts back-end/api-gateway/src/app.module.ts
```

---

## Task 16: `api-gateway` — `ReportsController` integration test

**Files:**
- Create: `back-end/api-gateway/src/reports/reports.controller.int.spec.ts`

**Interfaces:**
- Consumes: `ReportsModule` (Task 15), `SERVICE_B_RMQ_CLIENT` (Task 13).

- [ ] **Step 1: Write the failing tests**

`back-end/api-gateway/src/reports/reports.controller.int.spec.ts`:
```ts
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
import { ReportsModule } from './reports.module.js';

type App = Parameters<typeof request>[0];

describe('ReportsController (HTTP Integration)', () => {
  let app: INestApplication;
  let httpServer: App;
  let serviceBClient: { send: ReturnType<typeof vi.fn> };
  let reportDirectory: string;
  let reportPath: string;

  beforeAll(async () => {
    reportDirectory = mkdtempSync(join(tmpdir(), 'reports-controller-spec-'));
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
        ReportsModule,
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
    rmSync(reportDirectory, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    reportPath = join(reportDirectory, 'report.pdf');
    writeFileSync(reportPath, '%PDF-1.4 fake report body');
  });

  describe('GET /reports/pdf', () => {
    const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

    it('should return 200 with application/pdf content type, when the report is generated', async () => {
      serviceBClient.send.mockReturnValue(of({ reportPath }));

      const response = await request(httpServer).get('/reports/pdf').query({ importId });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/pdf');
      expect(response.headers['content-disposition']).toContain('attachment');
    });

    it('should forward importId inside the RMQ message, when provided', async () => {
      serviceBClient.send.mockReturnValue(of({ reportPath }));

      await request(httpServer).get('/reports/pdf').query({ importId });

      const [pattern, record] = serviceBClient.send.mock.calls[0] as [
        string,
        { data: { importId: string } },
      ];
      expect(pattern).toBe('reports.pdf.generate');
      expect(record.data).toEqual({ importId });
    });

    it('should delete the report file after the response finishes, when the download completes', async () => {
      serviceBClient.send.mockReturnValue(of({ reportPath }));

      await request(httpServer).get('/reports/pdf').query({ importId });
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });

      expect(existsSync(reportPath)).toBe(false);
    });

    it('should return 400 and not call service-b, when importId is not a uuid', async () => {
      const response = await request(httpServer).get('/reports/pdf').query({ importId: 'not-a-uuid' });

      expect(response.status).toBe(400);
      expect(serviceBClient.send).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter api-gateway test -- reports.controller.int.spec.ts`
Expected: FAIL (or the whole suite errors) — this is the first test exercising `ReportsModule` end-to-end;
if any wiring from Tasks 13–15 is wrong, it surfaces here.

- [ ] **Step 3: Run again after confirming Tasks 13–15 are complete**

Run: `pnpm --filter api-gateway test -- reports.controller.int.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 4: Run the full `api-gateway` test suite**

Run: `pnpm --filter api-gateway test`
Expected: PASS (every test from Tasks 11–16 plus the pre-existing suite).

- [ ] **Step 5: Lint**

Run: `pnpm --filter api-gateway lint`
Expected: PASS.

- [ ] **Step 6: Build**

Run: `pnpm --filter api-gateway build`
Expected: PASS.

- [ ] **Step 7: Stage the files**

```bash
git add back-end/api-gateway/src/reports/reports.controller.int.spec.ts
```

---

## Self-Review

**Spec coverage:** the design doc's "Service-b: PDF report generation (Phase 9)" section maps to: stats
gathering (Task 8 reuses Phase 8's `StatsService` as-is, Finding 2), downsampled time-series (already
downsampled by Phase 8, Finding 2), pdfkit build streamed to a file (Task 6), charts drawn with vector
primitives against small arrays (Task 5, with the "events by type" gap called out as Finding 3), reply with
`{reportPath}` (Task 9), gateway streaming the file back and cleaning it up (Task 14). The "Library choice:
pdfkit" rationale needs no code — it's satisfied by Task 1's dependency choice itself. `report-storage`/
`REPORT_DIR` infrastructure (design doc's "Infrastructure changes" section, deferred from Phase 0 per
Finding 1) is Task 12.

**Placeholder scan:** no TBD/TODO; every step shows complete code, exact commands, and expected output.

**Type/name consistency:** `IStatsResult`/`IImportTimeSeriesPoint` (Phase 8) flow unchanged into Task 5's
chart functions, Task 6's `buildReport`, and Task 7's `generateReport`. `IGenerateReportResult` (Task 7) is
reused unchanged by Task 8 (`ReportsService`), Task 9 (`ReportsController`)'s return type, and matches the
gateway's own `GenerateReportRpcResult` shape (Task 14, a local `type` alias for the RPC reply — the gateway
never imports service-b's server-side types directly, matching every other cross-service RPC boundary in
this codebase, e.g. `StatsController`'s `IStatsView` vs. service-b's `IStatsResult`). `reportConfig`'s
`ReportConfiguration { dir: string }` shape and `REPORT_DIR` env var name are identical in both services
(Tasks 2 and 11), matching `storageConfig`'s existing cross-service precedent.
