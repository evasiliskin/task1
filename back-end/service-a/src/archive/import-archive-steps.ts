import { basename } from 'node:path';

import {
  type ImportCompletedEvent,
  type ImportFailedEvent,
  type ImportStartedEvent,
} from '@task1/shared/github-archive/index';

import { type ImportSourceRecord } from './import-run.types.js';
import { type ImportResult } from './processing/process-archive.js';

export const METRIC_DOWNLOAD_DURATION = 'service_a.archive.download.duration';
export const METRIC_PROCESSING_DURATION = 'service_a.archive.processing.duration';
export const METRIC_EVENTS_PROCESSED = 'service_a.archive.events.processed';
export const METRIC_EVENTS_INVALID = 'service_a.archive.events.invalid';
export const METRIC_PROCESSING_ERRORS = 'service_a.archive.processing.errors';
export const METRIC_IMPORTS_FAILED = 'service_a.archive.imports.failed';
export const METRIC_FAILURE_DURATION = 'service_a.archive.failure.duration';

export type ImportSourceInput =
  | { readonly type: 'download'; readonly dateHour: string }
  | { readonly type: 'upload'; readonly filePath: string };

export interface IImportSource {
  archiveLabel: string;
  sourceRecord: ImportSourceRecord;
}

/**
 * The archive label is the business-facing name carried in every lifecycle event and stored on the
 * import run. It stays `<dateHour>.json.gz` for downloads even though Phase 3 made the on-disk path
 * importId-keyed — the two are deliberately different things.
 */
export function buildImportSource(source: ImportSourceInput): IImportSource {
  const archiveLabel =
    source.type === 'download' ? `${source.dateHour}.json.gz` : basename(source.filePath);

  return {
    archiveLabel,
    sourceRecord:
      source.type === 'download'
        ? { type: 'download', archive: archiveLabel }
        : { type: 'upload', filename: archiveLabel },
  };
}

export function buildCompletionMetrics(
  result: ImportResult,
  processingDurationMs: number,
): [string, number][] {
  const metrics: [string, number][] = [
    [METRIC_PROCESSING_DURATION, processingDurationMs],
    [METRIC_EVENTS_PROCESSED, result.eventsProcessed],
    [METRIC_EVENTS_INVALID, result.invalidEvents],
  ];

  if (result.errorCount > 0) {
    metrics.push([METRIC_PROCESSING_ERRORS, result.errorCount]);
  }

  return metrics;
}

/**
 * The failure-path counterpart of `buildCompletionMetrics`. Without it a completed import writes
 * five RedisTimeSeries points and a failed one writes none, so no dashboard over
 * `service_a.archive.*` can express a failure rate.
 *
 * The counter is always `1` rather than a running total: RedisTimeSeries aggregates the datapoints,
 * so summing the series over a window yields the failure count for that window.
 */
export function buildFailureMetrics(failureDurationMs: number): [string, number][] {
  return [
    [METRIC_IMPORTS_FAILED, 1],
    [METRIC_FAILURE_DURATION, failureDurationMs],
  ];
}

export function toStartedEvent(
  importId: string,
  archive: string,
  startedAt: Date,
): ImportStartedEvent {
  return { importId, archive, startedAt: startedAt.toISOString() };
}

export function toCompletedEvent(
  importId: string,
  archive: string,
  startedAt: Date,
  completedAt: Date,
  result: ImportResult,
): ImportCompletedEvent {
  return {
    importId,
    archive,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    eventsProcessed: result.eventsProcessed,
    validEvents: result.validEvents,
    invalidEvents: result.invalidEvents,
    duplicateEvents: result.duplicateEvents,
    errorCount: result.errorCount,
  };
}

export function toFailedEvent(
  importId: string,
  archive: string,
  startedAt: Date,
  failedAt: Date,
  reason: string,
): ImportFailedEvent {
  return {
    importId,
    archive,
    startedAt: startedAt.toISOString(),
    failedAt: failedAt.toISOString(),
    reason,
  };
}

/**
 * A downloaded archive is always disposable — it can be fetched again. A failed upload is kept for
 * diagnosis; the gateway's retention sweep collects it later.
 */
export function shouldDeleteArchive(source: ImportSourceInput, hasFailed: boolean): boolean {
  return source.type === 'download' || !hasFailed;
}
