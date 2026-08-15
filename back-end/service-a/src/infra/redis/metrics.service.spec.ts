import { type LoggerService } from '@task1/shared/logger/logger.service';
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

  function buildServiceWithPipeline(
    pipelineCall: ReturnType<typeof vi.fn>,
    pipelineExec: ReturnType<typeof vi.fn>,
    warnMock: ReturnType<typeof vi.fn>,
  ): MetricsService {
    const pipeline = { call: pipelineCall, exec: pipelineExec };
    const client = { pipeline: vi.fn().mockReturnValue(pipeline) } as unknown as Redis;
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
        { key: 'service_a.archive.events.processed', value: 42 },
        'Failed to record metric',
        expect.any(Error),
      );
    });
  });

  describe('recordMetrics', () => {
    it('should queue one TS.ADD per entry on a single pipeline and execute it once, when Redis is reachable', async () => {
      const pipelineCall = vi.fn();
      const pipelineExec = vi.fn().mockResolvedValue([]);
      const warnMock = vi.fn();
      const service = buildServiceWithPipeline(pipelineCall, pipelineExec, warnMock);

      await service.recordMetrics([
        ['service_a.archive.processing.duration', 120],
        ['service_a.archive.events.processed', 10],
      ]);

      expect(pipelineCall).toHaveBeenNthCalledWith(
        1,
        'TS.ADD',
        'service_a.archive.processing.duration',
        '*',
        120,
        'RETENTION',
        604_800_000,
      );
      expect(pipelineCall).toHaveBeenNthCalledWith(
        2,
        'TS.ADD',
        'service_a.archive.events.processed',
        '*',
        10,
        'RETENTION',
        604_800_000,
      );
      expect(pipelineExec).toHaveBeenCalledTimes(1);
      expect(warnMock).not.toHaveBeenCalled();
    });

    it('should log a warning identifying the failed metric and resolve without throwing, when the pipeline resolves with a per-command error', async () => {
      const pipelineCall = vi.fn();
      const pipelineExec = vi.fn().mockResolvedValue([
        [null, 1_700_000_000_000],
        [new Error('TSDB: key already exists'), null],
      ]);
      const warnMock = vi.fn();
      const service = buildServiceWithPipeline(pipelineCall, pipelineExec, warnMock);
      const entries: readonly (readonly [string, number])[] = [
        ['service_a.archive.processing.duration', 120],
        ['service_a.archive.events.processed', 10],
      ];

      await expect(service.recordMetrics(entries)).resolves.toBeUndefined();
      expect(warnMock).toHaveBeenCalledTimes(1);
      expect(warnMock).toHaveBeenCalledWith(
        { key: 'service_a.archive.events.processed', value: 10 },
        'Failed to record metric in batch',
        expect.any(Error),
      );
    });

    it('should log a warning and resolve without throwing, when the pipeline rejects', async () => {
      const pipelineCall = vi.fn();
      const pipelineExec = vi.fn().mockRejectedValue(new Error('connection lost'));
      const warnMock = vi.fn();
      const service = buildServiceWithPipeline(pipelineCall, pipelineExec, warnMock);
      const entries: readonly (readonly [string, number])[] = [
        ['service_a.archive.processing.duration', 120],
      ];

      await expect(service.recordMetrics(entries)).resolves.toBeUndefined();
      expect(warnMock).toHaveBeenCalledWith(
        { entries },
        'Failed to record metrics',
        expect.any(Error),
      );
    });
  });
});
