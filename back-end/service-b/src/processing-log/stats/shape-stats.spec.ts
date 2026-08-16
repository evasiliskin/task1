import { type IProcessingLogDocument } from '../processing-log.types.js';

import { shapeStats, shapeStatsFromDocuments } from './shape-stats.js';

describe('shapeStats', () => {
  it('should return all zeros, when no groups are given', () => {
    expect(shapeStats([])).toEqual({
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 0,
    });
  });

  it("should map the completed group's counters, when a completed group exists", () => {
    const groups = [
      {
        _id: 'completed',
        count: 3,
        eventsProcessed: 300,
        validEvents: 290,
        invalidEvents: 10,
        errorCount: 0,
      },
    ];

    expect(shapeStats(groups)).toEqual({
      archivesProcessed: 3,
      eventsProcessed: 300,
      successfulEvents: 290,
      invalidEvents: 10,
      errors: 0,
    });
  });

  it('should count failed archives as errors, when only a failed group exists', () => {
    const groups = [
      {
        _id: 'failed',
        count: 2,
        eventsProcessed: 0,
        validEvents: 0,
        invalidEvents: 0,
        errorCount: 0,
      },
    ];

    expect(shapeStats(groups)).toEqual({
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 2,
    });
  });

  it('should sum failed count and completed errorCount into errors, when both groups exist', () => {
    const groups = [
      {
        _id: 'completed',
        count: 3,
        eventsProcessed: 300,
        validEvents: 290,
        invalidEvents: 10,
        errorCount: 4,
      },
      {
        _id: 'failed',
        count: 2,
        eventsProcessed: 0,
        validEvents: 0,
        invalidEvents: 0,
        errorCount: 0,
      },
    ];

    expect(shapeStats(groups).errors).toBe(6);
  });

  it('should ignore a started group, when present alongside completed', () => {
    const groups = [
      {
        _id: 'started',
        count: 5,
        eventsProcessed: 0,
        validEvents: 0,
        invalidEvents: 0,
        errorCount: 0,
      },
      {
        _id: 'completed',
        count: 1,
        eventsProcessed: 100,
        validEvents: 100,
        invalidEvents: 0,
        errorCount: 0,
      },
    ];

    expect(shapeStats(groups).archivesProcessed).toBe(1);
  });
});

describe('shapeStatsFromDocuments', () => {
  function buildDocument(
    status: IProcessingLogDocument['status'],
    metadata: Record<string, number> = {},
  ): IProcessingLogDocument {
    return {
      importId: 'i1',
      eventType: 'e',
      service: 'service-a',
      status,
      timestamp: new Date('2026-08-11T00:00:00Z'),
      correlationId: 'c1',
      archive: 'a.json.gz',
      metadata,
    };
  }

  it('should produce zeroes for no documents', () => {
    expect(shapeStatsFromDocuments([])).toEqual({
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 0,
    });
  });

  it('should match shapeStats for the same single import', () => {
    const documents = [
      buildDocument('started'),
      buildDocument('completed', {
        eventsProcessed: 50,
        validEvents: 45,
        invalidEvents: 3,
        errorCount: 2,
      }),
    ];

    expect(shapeStatsFromDocuments(documents)).toEqual({
      archivesProcessed: 1,
      eventsProcessed: 50,
      successfulEvents: 45,
      invalidEvents: 3,
      errors: 2,
    });
  });

  it('should count a failed document as one error', () => {
    expect(shapeStatsFromDocuments([buildDocument('failed')])).toMatchObject({ errors: 1 });
  });
});
