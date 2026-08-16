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
    correlationId: 'c1',
    archive: '2026-08-11-0.json.gz',
    metadata,
  };
}

describe('buildRollupDelta', () => {
  it('should contribute nothing for a started entry', () => {
    expect(buildRollupDelta(buildEntry('started'))).toEqual({});
  });

  it('should contribute nothing for a dead-lettered entry', () => {
    expect(buildRollupDelta(buildEntry('dead-lettered'))).toEqual({});
  });

  it('should count a failed entry as one error', () => {
    expect(buildRollupDelta(buildEntry('failed'))).toEqual({ errors: 1 });
  });

  it('should map a completed entry exactly as shapeStats does', () => {
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

  it('should treat missing completed metadata as zero', () => {
    expect(buildRollupDelta(buildEntry('completed'))).toEqual({
      archivesProcessed: 1,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 0,
    });
  });

  it('should not carry duplicateEvents into the rollup', () => {
    const delta = buildRollupDelta(buildEntry('completed', { duplicateEvents: 5 }));

    expect(delta).not.toHaveProperty('duplicateEvents');
  });
});
