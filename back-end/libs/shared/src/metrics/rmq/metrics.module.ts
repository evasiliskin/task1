import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { LoggerModule } from '../../logger/rmq/logger.module.js';
import { MetricsService } from '../metrics.service.js';

import { RmqMetricsInterceptor } from './rmq-metrics.interceptor.js';

/**
 * Registers the transport-level metrics interceptor for an RMQ service, and provides the
 * `MetricsService` that domain code (service-a's import pipeline) also injects directly.
 *
 * `LoggerModule` is imported for `LoggerService`, which `MetricsService` needs; `REDIS_CLIENT` and
 * the `redis`/`logger` configs come from each service's `@Global()` `RedisModule` and the global
 * `ConfigModule`.
 */
@Module({
  imports: [LoggerModule],
  providers: [MetricsService, { provide: APP_INTERCEPTOR, useClass: RmqMetricsInterceptor }],
  exports: [MetricsService],
})
export class MetricsModule {}
