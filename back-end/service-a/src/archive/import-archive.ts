import { basename } from 'node:path';

import {
  EVENT_PATTERNS,
  type ImportCompletedEvent,
  type ImportFailedEvent,
  type ImportStartedEvent,
} from '@task1/shared/github-archive/index';

import { type ImportSourceRecord } from './import-run.types.js';
import { type ImportResult } from './processing/process-archive.js';

const METRIC_DOWNLOAD_DURATION = 'service_a.archive.download.duration';
const METRIC_PROCESSING_DURATION = 'service_a.archive.processing.duration';
const METRIC_EVENTS_PROCESSED = 'service_a.archive.events.processed';
const METRIC_EVENTS_INVALID = 'service_a.archive.events.invalid';
const METRIC_PROCESSING_ERRORS = 'service_a.archive.processing.errors';

export type ImportSourceInput =
  | { readonly type: 'download'; readonly dateHour: string }
  | { readonly type: 'upload'; readonly filePath: string };

export interface IImportArchiveDependencies {
  downloadArchive: (dateHour: string) => Promise<{ filePath: string }>;
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
}

export async function importArchive(
  source: ImportSourceInput,
  importId: string,
  correlationId: string,
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
    correlationId,
  };

  await dependencies.recordImportStarted(importId, sourceRecord, startedAt);
  dependencies.emitEvent(EVENT_PATTERNS.IMPORT_STARTED, startedEvent);

  let processedPath: string | undefined;
  let hasFailed = false;

  try {
    let filePath: string;

    if (source.type === 'download') {
      const downloadStartedAt = Date.now();
      const downloadResult = await dependencies.downloadArchive(source.dateHour);

      filePath = downloadResult.filePath;

      await dependencies.recordMetric(METRIC_DOWNLOAD_DURATION, Date.now() - downloadStartedAt);
    } else {
      filePath = source.filePath;
    }

    processedPath = filePath;

    const processingStartedAt = Date.now();
    const result = await dependencies.processArchive(filePath, importId);

    const completionMetrics: [string, number][] = [
      [METRIC_PROCESSING_DURATION, Date.now() - processingStartedAt],
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
      correlationId,
    };

    dependencies.emitEvent(EVENT_PATTERNS.IMPORT_COMPLETED, completedEvent);
    await dependencies.recordImportCompleted(importId, result, completedAt);

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
      correlationId,
    };

    dependencies.emitEvent(EVENT_PATTERNS.IMPORT_FAILED, failedEvent);
    await dependencies.recordImportFailed(importId, reason, failedAt);

    throw error;
  } finally {
    const shouldDelete = source.type === 'download' || !hasFailed;

    if (processedPath !== undefined && shouldDelete) {
      await dependencies.deleteArchive(processedPath).catch(() => undefined);
    }
  }
}
