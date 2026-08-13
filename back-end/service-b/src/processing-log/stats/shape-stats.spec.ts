import { shapeStats } from './shape-stats.js';

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
