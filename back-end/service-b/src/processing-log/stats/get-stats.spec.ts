import { type Collection } from 'mongodb';

import { type IProcessingLogDocument } from '../processing-log.types.js';

import { buildStatsPipeline } from './build-stats-pipeline.js';
import { getStats } from './get-stats.js';
import { type StatsMetricsReader } from './stats-metrics-reader.service.js';

describe('getStats', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const correlationId = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  function buildCollection(
    groups: unknown[],
    documents: IProcessingLogDocument[] = [],
  ): {
    collection: Collection<IProcessingLogDocument>;
    aggregate: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
  } {
    const aggregate = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(groups) });
    const find = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(documents) });

    return {
      collection: { aggregate, find } as unknown as Collection<IProcessingLogDocument>,
      aggregate,
      find,
    };
  }

  function buildMetricsReader(
    processingDurationMs: number | undefined,
    timeSeries: { timestamp: string; value: number }[],
  ): {
    reader: StatsMetricsReader;
    readAverageProcessingDuration: ReturnType<typeof vi.fn>;
    readEventsTimeSeries: ReturnType<typeof vi.fn>;
  } {
    const readAverageProcessingDuration = vi.fn().mockResolvedValue(processingDurationMs);
    const readEventsTimeSeries = vi.fn().mockResolvedValue(timeSeries);

    return {
      reader: {
        readAverageProcessingDuration,
        readEventsTimeSeries,
      } as unknown as StatsMetricsReader,
      readAverageProcessingDuration,
      readEventsTimeSeries,
    };
  }

  it('should return zeroed stats and empty timeSeries, when nothing matches and no importId is given', async () => {
    const { collection } = buildCollection([]);
    const { reader } = buildMetricsReader(undefined, []);

    const result = await getStats(collection, reader);

    expect(result).toEqual({
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 0,
      timeSeries: [],
    });
  });

  it('should combine mongo aggregation stats with Redis metrics, when no importId is given', async () => {
    const groups = [
      {
        _id: 'completed',
        count: 2,
        eventsProcessed: 200,
        validEvents: 190,
        invalidEvents: 10,
        errorCount: 0,
      },
    ];
    const { collection } = buildCollection(groups);
    const timeSeries = [{ timestamp: '2026-08-11T00:00:00.000Z', value: 100 }];
    const { reader } = buildMetricsReader(15_000, timeSeries);

    const result = await getStats(collection, reader);

    expect(result).toEqual({
      archivesProcessed: 2,
      eventsProcessed: 200,
      successfulEvents: 190,
      invalidEvents: 10,
      errors: 0,
      processingDurationMs: 15_000,
      timeSeries,
    });
  });

  it('should query find() and derive duration from timestamps, when importId is given', async () => {
    const groups = [
      {
        _id: 'completed',
        count: 1,
        eventsProcessed: 500,
        validEvents: 480,
        invalidEvents: 20,
        errorCount: 0,
      },
    ];
    const documents: IProcessingLogDocument[] = [
      {
        importId,
        eventType: 'github.import.started',
        service: 'service-a',
        status: 'started',
        timestamp: new Date('2026-08-11T00:00:00.000Z'),
        correlationId,
        archive: '2026-08-11-0.json.gz',
        metadata: {},
      },
      {
        importId,
        eventType: 'github.import.completed',
        service: 'service-a',
        status: 'completed',
        timestamp: new Date('2026-08-11T00:05:00.000Z'),
        correlationId,
        archive: '2026-08-11-0.json.gz',
        metadata: {
          eventsProcessed: 500,
          validEvents: 480,
          invalidEvents: 20,
          duplicateEvents: 0,
          errorCount: 0,
        },
      },
    ];
    const { collection, aggregate, find } = buildCollection(groups, documents);
    const { reader, readAverageProcessingDuration, readEventsTimeSeries } = buildMetricsReader(
      undefined,
      [],
    );

    const result = await getStats(collection, reader, importId);

    expect(aggregate).toHaveBeenCalledWith(buildStatsPipeline(importId));
    expect(find).toHaveBeenCalledWith({ importId });
    expect(readAverageProcessingDuration).not.toHaveBeenCalled();
    expect(readEventsTimeSeries).not.toHaveBeenCalled();
    expect(result).toEqual({
      archivesProcessed: 1,
      eventsProcessed: 500,
      successfulEvents: 480,
      invalidEvents: 20,
      errors: 0,
      processingDurationMs: 300_000,
      timeSeries: [{ timestamp: '2026-08-11T00:05:00.000Z', value: 500 }],
    });
  });

  it('should omit processingDurationMs and return empty timeSeries, when importId is given but only a started log exists', async () => {
    const documents: IProcessingLogDocument[] = [
      {
        importId,
        eventType: 'github.import.started',
        service: 'service-a',
        status: 'started',
        timestamp: new Date('2026-08-11T00:00:00.000Z'),
        correlationId,
        archive: '2026-08-11-0.json.gz',
        metadata: {},
      },
    ];
    const { collection } = buildCollection([], documents);
    const { reader } = buildMetricsReader(undefined, []);

    const result = await getStats(collection, reader, importId);

    expect(result.processingDurationMs).toBeUndefined();
    expect(result.timeSeries).toEqual([]);
  });

  it('should still read Redis metrics and resolve with zeroed Mongo stats instead of throwing, when the Mongo aggregation fails and no importId is given', async () => {
    const aggregate = vi.fn().mockReturnValue({
      toArray: vi.fn().mockRejectedValue(new Error('connection refused')),
    });
    const collection = { aggregate } as unknown as Collection<IProcessingLogDocument>;
    const timeSeries = [{ timestamp: '2026-08-11T00:00:00.000Z', value: 100 }];
    const { reader, readAverageProcessingDuration, readEventsTimeSeries } = buildMetricsReader(
      15_000,
      timeSeries,
    );

    const result = await getStats(collection, reader);

    expect(result).toEqual({
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 0,
      processingDurationMs: 15_000,
      timeSeries,
    });
    expect(readAverageProcessingDuration).toHaveBeenCalled();
    expect(readEventsTimeSeries).toHaveBeenCalled();
  });

  it('should resolve with zeroed stats instead of throwing, when the Mongo aggregation fails for a specific importId', async () => {
    const aggregate = vi.fn().mockReturnValue({
      toArray: vi.fn().mockRejectedValue(new Error('connection refused')),
    });
    const find = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    const collection = { aggregate, find } as unknown as Collection<IProcessingLogDocument>;
    const { reader } = buildMetricsReader(undefined, []);

    const result = await getStats(collection, reader, importId);

    expect(result).toEqual({
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 0,
      timeSeries: [],
    });
  });
});
