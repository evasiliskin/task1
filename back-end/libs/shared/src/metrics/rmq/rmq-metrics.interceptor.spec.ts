import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { firstValueFrom, lastValueFrom, of, throwError } from 'rxjs';

import { type ILoggerConfiguration } from '../../config/logger.config.js';
import { RPC_PATTERNS } from '../../messaging/rpc-patterns.const.js';
import { type MetricsService } from '../metrics.service.js';

import { RmqMetricsInterceptor } from './rmq-metrics.interceptor.js';

const LOGGER_CONFIGURATION: ILoggerConfiguration = {
  level: 'info',
  transport: 'json',
  serviceName: 'service-a',
};

function buildExecutionContext(pattern: string): ExecutionContext {
  return {
    switchToRpc: () => ({ getContext: () => ({ getPattern: () => pattern }) }),
  } as unknown as ExecutionContext;
}

function buildInterceptor(recordMetric: ReturnType<typeof vi.fn>): RmqMetricsInterceptor {
  const metricsService = { recordMetric } as unknown as MetricsService;

  return new RmqMetricsInterceptor(metricsService, LOGGER_CONFIGURATION);
}

describe('RmqMetricsInterceptor', () => {
  it('should record exactly one request counter for the pattern, when the handler succeeds', async () => {
    const recordMetric = vi.fn().mockResolvedValue(undefined);
    const interceptor = buildInterceptor(recordMetric);

    await firstValueFrom(
      interceptor.intercept(buildExecutionContext('events.search'), { handle: () => of('ok') }),
    );

    expect(recordMetric).toHaveBeenCalledTimes(1);
    expect(recordMetric).toHaveBeenCalledWith('service_a.rmq.events.search.requests', 1);
  });

  it('should pass the handler result through unchanged, when the handler succeeds', async () => {
    const interceptor = buildInterceptor(vi.fn().mockResolvedValue(undefined));

    const result = await firstValueFrom(
      interceptor.intercept(buildExecutionContext('stats.get'), {
        handle: () => of({ eventsProcessed: 7 }),
      }),
    );

    expect(result).toEqual({ eventsProcessed: 7 });
  });

  it('should record both a request and an error counter, when the handler throws', async () => {
    const recordMetric = vi.fn().mockResolvedValue(undefined);
    const interceptor = buildInterceptor(recordMetric);

    await expect(
      firstValueFrom(
        interceptor.intercept(buildExecutionContext('imports.claim'), {
          handle: () => throwError(() => new Error('mongo down')),
        }),
      ),
    ).rejects.toThrow('mongo down');

    expect(recordMetric).toHaveBeenNthCalledWith(1, 'service_a.rmq.imports.claim.requests', 1);
    expect(recordMetric).toHaveBeenNthCalledWith(2, 'service_a.rmq.imports.claim.errors', 1);
  });

  it('should record nothing at all, when the pattern is the health check', async () => {
    const recordMetric = vi.fn().mockResolvedValue(undefined);
    const interceptor = buildInterceptor(recordMetric);

    await lastValueFrom(
      interceptor.intercept(buildExecutionContext(RPC_PATTERNS.HEALTH_CHECK), {
        handle: () => of('ok'),
      }),
    );

    expect(recordMetric).not.toHaveBeenCalled();
  });

  it('should still deliver the handler result, when recording the metric rejects', async () => {
    const recordMetric = vi.fn().mockRejectedValue(new Error('redis down'));
    const interceptor = buildInterceptor(recordMetric);
    const handler: CallHandler = { handle: () => of('ok') };

    await expect(
      firstValueFrom(interceptor.intercept(buildExecutionContext('logs.search'), handler)),
    ).resolves.toBe('ok');
  });

  it('should use the configured service name in the key, when the service is service-b', async () => {
    const recordMetric = vi.fn().mockResolvedValue(undefined);
    const metricsService = { recordMetric } as unknown as MetricsService;
    const interceptor = new RmqMetricsInterceptor(metricsService, {
      ...LOGGER_CONFIGURATION,
      serviceName: 'service-b',
    });

    await firstValueFrom(
      interceptor.intercept(buildExecutionContext('reports.pdf.generate'), {
        handle: () => of('ok'),
      }),
    );

    expect(recordMetric).toHaveBeenCalledWith('service_b.rmq.reports.pdf.generate.requests', 1);
  });
});
