import { type IProcessingLogDocument } from '../processing-log.types.js';

import { buildRollupDelta } from './rollup-delta.js';

function buildEntry(
  status: IProcessingLogDocument['status'],
  metadata: Record<string, number> = {},
): IProcessingLogDocument {
  return {
    importId: '11111111-1111-4111-8111-111111111111',
    eventType: 'github.import.completed',
    service: 'service-a',
    status,
    timestamp: new Date('2026-08-11T00:00:00Z'),
    correlationId: '8f14e45f-ceea-4e0a-9d1b-3a2e6f7c8b90',
    archive: '2026-08-11-0.json.gz',
    metadata,
  };
}

describe('buildRollupDelta', () => {
  it('should contribute nothing, when the entry is started', () => {
    expect(buildRollupDelta(buildEntry('started'))).toEqual({});
  });

  it('should contribute nothing, when the entry is dead-lettered', () => {
    expect(buildRollupDelta(buildEntry('dead-lettered'))).toEqual({});
  });

  it('should count one error, when the entry failed', () => {
    expect(buildRollupDelta(buildEntry('failed'))).toEqual({ errors: 1 });
  });

  it('should map the entry exactly as shapeStats does, when the entry completed', () => {
    const delta = buildRollupDelta(
      buildEntry('completed', {
        eventsProcessed: 100,
        validEvents: 90,
        invalidEvents: 7,
        duplicateEvents: 2,
        errorCount: 3,
      }),
    );

    expect(delta).toEqual({
      archivesProcessed: 1,
      eventsProcessed: 100,
      successfulEvents: 90,
      invalidEvents: 7,
      errors: 3,
    });
  });

  it('should omit the zero counters, when the completed metadata is missing', () => {
    expect(buildRollupDelta(buildEntry('completed'))).toEqual({ archivesProcessed: 1 });
  });

  it('should omit duplicateEvents from the delta, when the entry completed', () => {
    const delta = buildRollupDelta(buildEntry('completed', { duplicateEvents: 5 }));

    expect(delta).not.toHaveProperty('duplicateEvents');
  });
});
