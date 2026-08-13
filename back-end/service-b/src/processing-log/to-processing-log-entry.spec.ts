import {
  type ImportCompletedEvent,
  type ImportFailedEvent,
  type ImportStartedEvent,
} from '@task1/shared/github-archive/index';

import {
  toCompletedLogEntry,
  toFailedLogEntry,
  toStartedLogEntry,
} from './to-processing-log-entry.js';

describe('toProcessingLogEntry', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const correlationId = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const archive = '2026-08-11-0.json.gz';

  describe('toStartedLogEntry', () => {
    it('should map a started event to a started log entry with empty metadata, when called', () => {
      const event: ImportStartedEvent = {
        importId,
        archive,
        startedAt: '2026-08-11T00:00:00.000Z',
        correlationId,
      };

      const result = toStartedLogEntry(event, 'github.import.started');

      expect(result).toEqual({
        importId,
        eventType: 'github.import.started',
        service: 'service-a',
        status: 'started',
        timestamp: new Date('2026-08-11T00:00:00.000Z'),
        correlationId,
        archive,
        metadata: {},
      });
    });
  });

  describe('toCompletedLogEntry', () => {
    it('should map a completed event to a completed log entry with the result counters as metadata, when called', () => {
      const event: ImportCompletedEvent = {
        importId,
        archive,
        startedAt: '2026-08-11T00:00:00.000Z',
        completedAt: '2026-08-11T00:05:00.000Z',
        eventsProcessed: 10,
        validEvents: 8,
        invalidEvents: 1,
        duplicateEvents: 1,
        errorCount: 0,
        correlationId,
      };

      const result = toCompletedLogEntry(event, 'github.import.completed');

      expect(result).toEqual({
        importId,
        eventType: 'github.import.completed',
        service: 'service-a',
        status: 'completed',
        timestamp: new Date('2026-08-11T00:05:00.000Z'),
        correlationId,
        archive,
        metadata: {
          eventsProcessed: 10,
          validEvents: 8,
          invalidEvents: 1,
          duplicateEvents: 1,
          errorCount: 0,
        },
      });
    });
  });

  describe('toFailedLogEntry', () => {
    it('should map a failed event to a failed log entry with errorInfo, when the reason is short', () => {
      const event: ImportFailedEvent = {
        importId,
        archive,
        startedAt: '2026-08-11T00:00:00.000Z',
        failedAt: '2026-08-11T00:02:00.000Z',
        reason: 'download failed: 404 Not Found',
        correlationId,
      };

      const result = toFailedLogEntry(event, 'github.import.failed');

      expect(result).toEqual({
        importId,
        eventType: 'github.import.failed',
        service: 'service-a',
        status: 'failed',
        timestamp: new Date('2026-08-11T00:02:00.000Z'),
        correlationId,
        archive,
        metadata: {},
        errorInfo: { reason: 'download failed: 404 Not Found' },
      });
    });

    it('should truncate the stored reason to 500 characters, when the reason is longer', () => {
      const longReason = 'x'.repeat(600);
      const event: ImportFailedEvent = {
        importId,
        archive,
        startedAt: '2026-08-11T00:00:00.000Z',
        failedAt: '2026-08-11T00:02:00.000Z',
        reason: longReason,
        correlationId,
      };

      const result = toFailedLogEntry(event, 'github.import.failed');

      expect(result.errorInfo).toEqual({ reason: longReason.slice(0, 500) });
    });
  });
});
