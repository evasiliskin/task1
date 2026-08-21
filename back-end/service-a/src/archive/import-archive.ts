import { EVENT_PATTERNS } from '@task1/shared/github-archive/index';
import { type AppLogger } from '@task1/shared/logger/app-logger';

import {
  buildCompletionMetrics,
  buildFailureMetrics,
  buildImportSource,
  METRIC_DOWNLOAD_DURATION,
  shouldDeleteArchive,
  toCompletedEvent,
  toFailedEvent,
  toStartedEvent,
  type ImportSourceInput,
} from './import-archive-steps.js';
import { type ImportDeliveryKind } from './import-delivery-kind.js';
import { type ImportSourceRecord } from './import-run.types.js';
import { type ImportResult } from './processing/process-archive.js';

export { type ImportSourceInput } from './import-archive-steps.js';

const IMPORT_STARTED_LOG = 'import started';
const ARCHIVE_DOWNLOADED_LOG = 'archive downloaded';
const ARCHIVE_PROCESSED_LOG = 'archive processed';
const IMPORT_COMPLETED_LOG = 'import completed';
const IMPORT_FAILED_LOG = 'import failed';

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
    delivery: ImportDeliveryKind,
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

async function resolveArchivePath(
  source: ImportSourceInput,
  importId: string,
  dependencies: IImportArchiveDependencies,
  logger: AppLogger,
): Promise<string> {
  if (source.type === 'upload') {
    return source.filePath;
  }

  const startedAt = Date.now();
  const { filePath } = await dependencies.downloadArchive(source.dateHour, importId);
  const durationMs = Date.now() - startedAt;

  logger.info({ durationMs }, ARCHIVE_DOWNLOADED_LOG);
  await dependencies.recordMetric(METRIC_DOWNLOAD_DURATION, durationMs);

  return filePath;
}

export async function importArchive(
  source: ImportSourceInput,
  importId: string,
  dependencies: IImportArchiveDependencies,
  delivery: ImportDeliveryKind = 'fresh',
): Promise<ImportResult> {
  const startedAt = new Date();
  const { archiveLabel, sourceRecord } = buildImportSource(source);

  const logger = dependencies.logger.with({ importId, archive: archiveLabel });

  logger.info({ importSource: sourceRecord.type, delivery }, IMPORT_STARTED_LOG);

  await dependencies.recordImportStarted(importId, sourceRecord, startedAt, delivery);
  dependencies.emitEvent(
    EVENT_PATTERNS.IMPORT_STARTED,
    toStartedEvent(importId, archiveLabel, startedAt),
  );

  let processedPath: string | undefined;
  let hasFailed = false;

  try {
    const filePath = await resolveArchivePath(source, importId, dependencies, logger);

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

    await dependencies.recordMetrics(buildCompletionMetrics(result, processingDurationMs));

    const completedAt = new Date();

    await dependencies.recordImportCompleted(importId, result, completedAt);
    dependencies.emitEvent(
      EVENT_PATTERNS.IMPORT_COMPLETED,
      toCompletedEvent(importId, archiveLabel, startedAt, completedAt, result),
    );

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

    await dependencies.recordMetrics(buildFailureMetrics(failedAt.getTime() - startedAt.getTime()));

    await dependencies.recordImportFailed(importId, reason, failedAt);
    dependencies.emitEvent(
      EVENT_PATTERNS.IMPORT_FAILED,
      toFailedEvent(importId, archiveLabel, startedAt, failedAt, reason),
    );

    logger.error(
      { durationMs: failedAt.getTime() - startedAt.getTime() },
      IMPORT_FAILED_LOG,
      error,
    );

    throw error;
  } finally {
    if (processedPath !== undefined && shouldDeleteArchive(source, hasFailed)) {
      await dependencies.deleteArchive(processedPath).catch(() => undefined);
    }
  }
}
