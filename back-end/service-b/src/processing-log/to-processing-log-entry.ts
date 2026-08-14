import {
  type ImportCompletedEvent,
  type ImportFailedEvent,
  type ImportStartedEvent,
} from '@task1/shared/github-archive/index';

import { type IProcessingLogDocument } from './processing-log.types.js';

const ERROR_REASON_MAX_LENGTH = 500;

export function toStartedLogEntry(
  event: ImportStartedEvent,
  eventType: string,
): IProcessingLogDocument {
  return {
    importId: event.importId,
    eventType,
    service: 'service-a',
    status: 'started',
    timestamp: new Date(event.startedAt),
    correlationId: event.correlationId,
    archive: event.archive,
    metadata: {},
  };
}

export function toCompletedLogEntry(
  event: ImportCompletedEvent,
  eventType: string,
): IProcessingLogDocument {
  return {
    importId: event.importId,
    eventType,
    service: 'service-a',
    status: 'completed',
    timestamp: new Date(event.completedAt),
    correlationId: event.correlationId,
    archive: event.archive,
    metadata: {
      eventsProcessed: event.eventsProcessed,
      validEvents: event.validEvents,
      invalidEvents: event.invalidEvents,
      duplicateEvents: event.duplicateEvents,
      errorCount: event.errorCount,
    },
  };
}

export function toFailedLogEntry(
  event: ImportFailedEvent,
  eventType: string,
): IProcessingLogDocument {
  return {
    importId: event.importId,
    eventType,
    service: 'service-a',
    status: 'failed',
    timestamp: new Date(event.failedAt),
    correlationId: event.correlationId,
    archive: event.archive,
    metadata: {},
    errorInfo: { reason: event.reason.slice(0, ERROR_REASON_MAX_LENGTH) },
  };
}
