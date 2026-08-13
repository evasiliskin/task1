import { type LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Collection } from 'mongodb';

import { type IProcessingLogDocument } from '../processing-log.types.js';

import { type StatsMetricsReader } from './stats-metrics-reader.service.js';
import { StatsService } from './stats.service.js';

describe('StatsService', () => {
  it('should delegate to getStats with the injected collection, metrics reader, and logger, when getStats is called', async () => {
    const aggregate = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    const find = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    const collection = { aggregate, find } as unknown as Collection<IProcessingLogDocument>;
    const metricsReader = {
      readAverageProcessingDuration: vi.fn().mockResolvedValue(undefined),
      readEventsTimeSeries: vi.fn().mockResolvedValue([]),
    } as unknown as StatsMetricsReader;
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ warn: vi.fn() }),
    } as unknown as LoggerService;
    const service = new StatsService(collection, metricsReader, loggerService);

    const result = await service.getStats();

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
