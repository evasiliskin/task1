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

export function shouldDeleteArchive(source: ImportSourceInput, hasFailed: boolean): boolean {
  return source.type === 'download' || !hasFailed;
}
