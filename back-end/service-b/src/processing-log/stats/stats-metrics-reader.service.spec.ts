import { type RedisConfiguration } from '@task1/shared/config/redis.config';
import { type LoggerService } from '@task1/shared/logger/logger.service';
import { type Redis } from 'ioredis';

import { StatsMetricsReader } from './stats-metrics-reader.service.js';

describe('StatsMetricsReader', () => {
  const redisConfiguration: RedisConfiguration = {
    url: 'redis://localhost:6379',
    metricsRetentionMs: 604_800_000,
  };

  function buildReader(
    call: ReturnType<typeof vi.fn>,
    warnMock: ReturnType<typeof vi.fn> = vi.fn(),
  ): StatsMetricsReader {
    const client = { call } as unknown as Redis;
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ warn: warnMock }),
    } as unknown as LoggerService;

    return new StatsMetricsReader(client, redisConfiguration, loggerService);
  }

  describe('readAverageProcessingDuration', () => {
    it('should return the last averaged sample as a number, when Redis returns TS.RANGE data', async () => {
      const call = vi.fn().mockResolvedValue([
        [1_691_712_000_000, '100'],
        [1_691_712_120_000, '150'],
      ]);
      const reader = buildReader(call);

      await expect(reader.readAverageProcessingDuration()).resolves.toEqual({
        value: 150,
        degraded: false,
      });
    });

    it('should return undefined, when Redis returns an empty series', async () => {
      const call = vi.fn().mockResolvedValue([]);
      const reader = buildReader(call);

      await expect(reader.readAverageProcessingDuration()).resolves.toEqual({
        value: undefined,
        degraded: false,
      });
    });

    it('should average one bucket aligned to the start of the retention window, when called', async () => {
      const call = vi.fn().mockResolvedValue([]);
      const reader = buildReader(call);

      await reader.readAverageProcessingDuration();

      expect(call).toHaveBeenCalledWith(
        'TS.RANGE',
        'service_a.archive.processing.duration',
        expect.any(Number),
        '+',
        'ALIGN',
        'start',
        'AGGREGATION',
        'avg',
        604_800_000,
      );
    });

    it('should start the window one retention period ago, when called', async () => {
      const call = vi.fn().mockResolvedValue([]);
      const reader = buildReader(call);
      const before = Date.now();

      await reader.readAverageProcessingDuration();

      const fromTimestamp = call.mock.calls[0][2] as number;

      expect(fromTimestamp).toBeGreaterThanOrEqual(before - 604_800_000);
      expect(fromTimestamp).toBeLessThanOrEqual(Date.now() - 604_800_000);
    });

    it('should return undefined and degraded true, and log a warning, when Redis rejects', async () => {
      const call = vi.fn().mockRejectedValue(new Error('connection lost'));
      const warnMock = vi.fn();
      const reader = buildReader(call, warnMock);

      await expect(reader.readAverageProcessingDuration()).resolves.toEqual({
        value: undefined,
        degraded: true,
      });
      expect(warnMock).toHaveBeenCalledWith(
        {},
        'Failed to read average processing duration metric',
        expect.any(Error),
      );
    });
  });

  describe('readEventsTimeSeries', () => {
    it('should map each TS.RANGE sample to an ISO timestamp and numeric value, when Redis returns data', async () => {
      const call = vi.fn().mockResolvedValue([
        [1_691_712_000_000, '10'],
        [1_691_712_120_000, '12'],
      ]);
      const reader = buildReader(call);

      await expect(reader.readEventsTimeSeries()).resolves.toEqual({
        timeSeries: [
          { timestamp: new Date(1_691_712_000_000).toISOString(), value: 10 },
          { timestamp: new Date(1_691_712_120_000).toISOString(), value: 12 },
        ],
        degraded: false,
      });
    });

    it('should sum each bucket over a series capped at 50 points, when called', async () => {
      const call = vi.fn().mockResolvedValue([]);
      const reader = buildReader(call);

      await reader.readEventsTimeSeries();

      expect(call).toHaveBeenCalledWith(
        'TS.RANGE',
        'service_a.archive.events.processed',
        expect.any(Number),
        '+',
        'ALIGN',
        'start',
        'AGGREGATION',
        'sum',
        Math.ceil(604_800_000 / 50),
      );
    });

    it('should return an empty array and degraded true, and log a warning, when Redis rejects', async () => {
      const call = vi.fn().mockRejectedValue(new Error('connection lost'));
      const warnMock = vi.fn();
      const reader = buildReader(call, warnMock);

      await expect(reader.readEventsTimeSeries()).resolves.toEqual({
        timeSeries: [],
        degraded: true,
      });
      expect(warnMock).toHaveBeenCalledWith(
        {},
        'Failed to read events-processed time series metric',
        expect.any(Error),
      );
    });
  });
});
