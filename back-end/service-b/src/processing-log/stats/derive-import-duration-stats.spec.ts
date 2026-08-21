import { type IProcessingLogDocument } from '../processing-log.types.js';

import { deriveImportDurationStats } from './derive-import-duration-stats.js';

describe('deriveImportDurationStats', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const correlationId = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const archive = '2026-08-11-0.json.gz';

  function buildDocument(overrides: Partial<IProcessingLogDocument>): IProcessingLogDocument {
    return {
      importId,
      eventType: 'github.import.started',
      service: 'service-a',
      status: 'started',
      timestamp: new Date('2026-08-11T00:00:00.000Z'),
      correlationId,
      archive,
      metadata: {},
      ...overrides,
    };
  }

  it('should return empty timeSeries and no processingDurationMs, when no documents are given', () => {
    expect(deriveImportDurationStats([])).toEqual({ timeSeries: [] });
  });

  it('should return empty timeSeries and no processingDurationMs, when only a started document exists', () => {
    const documents = [buildDocument({ status: 'started' })];

    expect(deriveImportDurationStats(documents)).toEqual({ timeSeries: [] });
  });

  it('should compute the duration and a single time-series point, when both started and completed documents exist', () => {
    const documents = [
      buildDocument({ status: 'started', timestamp: new Date('2026-08-11T00:00:00.000Z') }),
      buildDocument({
        status: 'completed',
        timestamp: new Date('2026-08-11T00:05:00.000Z'),
        metadata: {
          eventsProcessed: 500,
          validEvents: 480,
          invalidEvents: 20,
          duplicateEvents: 0,
          errorCount: 0,
        },
      }),
    ];

    expect(deriveImportDurationStats(documents)).toEqual({
      processingDurationMs: 300_000,
      timeSeries: [{ timestamp: '2026-08-11T00:05:00.000Z', value: 500 }],
    });
  });

  it('should ignore a failed document, when deriving duration for a completed import', () => {
    const documents = [
      buildDocument({ status: 'started', timestamp: new Date('2026-08-11T00:00:00.000Z') }),
      buildDocument({
        status: 'completed',
        timestamp: new Date('2026-08-11T00:05:00.000Z'),
        metadata: {
          eventsProcessed: 500,
          validEvents: 480,
          invalidEvents: 20,
          duplicateEvents: 0,
          errorCount: 0,
        },
      }),
      buildDocument({
        status: 'failed',
        timestamp: new Date('2026-08-11T00:06:00.000Z'),
        errorInfo: { reason: 'redelivered duplicate' },
      }),
    ];

    expect(deriveImportDurationStats(documents).processingDurationMs).toBe(300_000);
  });
});
