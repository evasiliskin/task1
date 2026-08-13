import { type LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Redis } from 'ioredis';

import { type RedisConfiguration } from '../../config/redis.config.js';

import { MetricsService } from './metrics.service.js';

describe('MetricsService', () => {
  const redisConfiguration: RedisConfiguration = {
    url: 'redis://localhost:6379',
    metricsRetentionMs: 604_800_000,
  };

  function buildService(
    call: ReturnType<typeof vi.fn>,
    warnMock: ReturnType<typeof vi.fn>,
  ): MetricsService {
    const client = { call } as unknown as Redis;
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ warn: warnMock }),
    } as unknown as LoggerService;

    return new MetricsService(client, redisConfiguration, loggerService);
  }

  describe('recordMetric', () => {
    it('should call TS.ADD with an automatic timestamp and the configured retention, when Redis is reachable', async () => {
      const call = vi.fn().mockResolvedValue(1_700_000_000_000);
      const warnMock = vi.fn();
      const service = buildService(call, warnMock);

      await service.recordMetric('service_a.archive.events.processed', 42);

      expect(call).toHaveBeenCalledWith(
        'TS.ADD',
        'service_a.archive.events.processed',
        '*',
        42,
        'RETENTION',
        604_800_000,
      );
      expect(warnMock).not.toHaveBeenCalled();
    });

    it('should log a warning and resolve without throwing, when Redis rejects the call', async () => {
      const call = vi.fn().mockRejectedValue(new Error('connection lost'));
      const warnMock = vi.fn();
      const service = buildService(call, warnMock);

      await expect(
        service.recordMetric('service_a.archive.events.processed', 42),
      ).resolves.toBeUndefined();
      expect(warnMock).toHaveBeenCalledWith(
        { key: 'service_a.archive.events.processed', value: 42, error: 'connection lost' },
        'Failed to record metric',
      );
    });
  });
});
