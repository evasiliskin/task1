import { basename } from 'node:path';

import {
  EVENT_PATTERNS,
  type ImportCompletedEvent,
  type ImportFailedEvent,
  type ImportStartedEvent,
} from '@task1/shared/github-archive/index';
import { type AppLogger } from '@task1/shared/logger/app-logger';

import { type ImportSourceRecord } from './import-run.types.js';
import { type ImportResult } from './processing/process-archive.js';

const METRIC_DOWNLOAD_DURATION = 'service_a.archive.download.duration';
const METRIC_PROCESSING_DURATION = 'service_a.archive.processing.duration';
const METRIC_EVENTS_PROCESSED = 'service_a.archive.events.processed';
const METRIC_EVENTS_INVALID = 'service_a.archive.events.invalid';
const METRIC_PROCESSING_ERRORS = 'service_a.archive.processing.errors';

const IMPORT_STARTED_LOG = 'import started';
const ARCHIVE_DOWNLOADED_LOG = 'archive downloaded';
const ARCHIVE_PROCESSED_LOG = 'archive processed';
const IMPORT_COMPLETED_LOG = 'import completed';
const IMPORT_FAILED_LOG = 'import failed';

export type ImportSourceInput =
  | { readonly type: 'download'; readonly dateHour: string }
  | { readonly type: 'upload'; readonly filePath: string };

export interface IImportArchiveDependencies {
  downloadArchive: (dateHour: string, importId: string) => Promise<{ filePath: string }>;
  processArchive: (filePath: string, importId: string) => Promise<ImportResult>;
  emitEvent: (pattern: string, payload: unknown) => void;
  recordMetric: (key: string, value: number) => Promise<void>;
  recordMetrics: (entries: readonly (readonly [string, number])[]) => Promise<void>;
  recordImportStarted: (
    importId: string,
    source: ImportSourceRecord,
    startedAt: Date,
  ) => Promise<void>;
  recordImportCompleted: (
    importId: string,
    result: ImportResult,
    completedAt: Date,
  ) => Promise<void>;
  recordImportFailed: (importId: string, reason: string, failedAt: Date) => Promise<void>;
  deleteArchive: (filePath: string) => Promise<void>;
  logger: AppLogger;
}

export async function importArchive(
  source: ImportSourceInput,
  importId: string,
  dependencies: IImportArchiveDependencies,
): Promise<ImportResult> {
  const startedAt = new Date();
  const archiveLabel =
    source.type === 'download' ? `${source.dateHour}.json.gz` : basename(source.filePath);
  const sourceRecord: ImportSourceRecord =
    source.type === 'download'
      ? { type: 'download', archive: archiveLabel }
      : { type: 'upload', filename: archiveLabel };

  const startedEvent: ImportStartedEvent = {
    importId,
    archive: archiveLabel,
    startedAt: startedAt.toISOString(),
  };

  // Bound once: every line below — and every warning the injected dependencies emit — carries
  // importId without any call site having to remember it.
  const logger = dependencies.logger.with({ importId, archive: archiveLabel });

  logger.info({ importSource: sourceRecord.type }, IMPORT_STARTED_LOG);

  await dependencies.recordImportStarted(importId, sourceRecord, startedAt);
  dependencies.emitEvent(EVENT_PATTERNS.IMPORT_STARTED, startedEvent);

  let processedPath: string | undefined;
  let hasFailed = false;

  try {
    let filePath: string;

    if (source.type === 'download') {
      const downloadStartedAt = Date.now();
      const downloadResult = await dependencies.downloadArchive(source.dateHour, importId);

      filePath = downloadResult.filePath;

      const downloadDurationMs = Date.now() - downloadStartedAt;

      logger.info({ durationMs: downloadDurationMs }, ARCHIVE_DOWNLOADED_LOG);
      await dependencies.recordMetric(METRIC_DOWNLOAD_DURATION, downloadDurationMs);
    } else {
      filePath = source.filePath;
    }

    processedPath = filePath;

    const processingStartedAt = Date.now();
    const result = await dependencies.processArchive(filePath, importId);
    const processingDurationMs = Date.now() - processingStartedAt;

    logger.info(
      {
        durationMs: processingDurationMs,
        eventsProcessed: result.eventsProcessed,
        validEvents: result.validEvents,
        invalidEvents: result.invalidEvents,
        duplicateEvents: result.duplicateEvents,
        errorCount: result.errorCount,
      },
      ARCHIVE_PROCESSED_LOG,
    );

    const completionMetrics: [string, number][] = [
      [METRIC_PROCESSING_DURATION, processingDurationMs],
      [METRIC_EVENTS_PROCESSED, result.eventsProcessed],
      [METRIC_EVENTS_INVALID, result.invalidEvents],
    ];

    if (result.errorCount > 0) {
      completionMetrics.push([METRIC_PROCESSING_ERRORS, result.errorCount]);
    }

    await dependencies.recordMetrics(completionMetrics);

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
    };

    dependencies.emitEvent(EVENT_PATTERNS.IMPORT_COMPLETED, completedEvent);
    await dependencies.recordImportCompleted(importId, result, completedAt);

    logger.info(
      {
        eventsProcessed: result.eventsProcessed,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
      IMPORT_COMPLETED_LOG,
    );

    return result;
  } catch (error) {
    hasFailed = true;

    const failedAt = new Date();
    const reason = error instanceof Error ? error.message : String(error);
    const failedEvent: ImportFailedEvent = {
      importId,
      archive: archiveLabel,
      startedAt: startedAt.toISOString(),
      failedAt: failedAt.toISOString(),
      reason,
    };

    dependencies.emitEvent(EVENT_PATTERNS.IMPORT_FAILED, failedEvent);
    await dependencies.recordImportFailed(importId, reason, failedAt);

    logger.error(
      { durationMs: failedAt.getTime() - startedAt.getTime() },
      IMPORT_FAILED_LOG,
      error,
    );

    throw error;
  } finally {
    const shouldDelete = source.type === 'download' || !hasFailed;

    if (processedPath !== undefined && shouldDelete) {
      await dependencies.deleteArchive(processedPath).catch(() => undefined);
    }
  }
}
