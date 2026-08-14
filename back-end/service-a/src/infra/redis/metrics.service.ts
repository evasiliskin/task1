import { Inject, Injectable } from '@nestjs/common';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Redis } from 'ioredis';

import redisConfig, { type RedisConfiguration } from '../../config/redis.config.js';
import { REDIS_CLIENT } from '../infra-clients.tokens.js';

const AUTOMATIC_TIMESTAMP = '*';
const FAILED_METRIC_LOG_MESSAGE = 'Failed to record metric';
const FAILED_METRICS_LOG_MESSAGE = 'Failed to record metrics';
const FAILED_METRICS_ENTRY_LOG_MESSAGE = 'Failed to record metric in batch';

@Injectable()
export class MetricsService {
  public constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    @Inject(redisConfig.KEY) private readonly redisConfiguration: RedisConfiguration,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger('MetricsService');
  }

  public async recordMetric(key: string, value: number): Promise<void> {
    try {
      await this.client.call(
        'TS.ADD',
        key,
        AUTOMATIC_TIMESTAMP,
        value,
        'RETENTION',
        this.redisConfiguration.metricsRetentionMs,
      );
    } catch (error) {
      this.logger.warn({ key, value }, FAILED_METRIC_LOG_MESSAGE, error);
    }
  }

  public async recordMetrics(entries: readonly (readonly [string, number])[]): Promise<void> {
    try {
      const pipeline = this.client.pipeline();

      for (const [key, value] of entries) {
        pipeline.call(
          'TS.ADD',
          key,
          AUTOMATIC_TIMESTAMP,
          value,
          'RETENTION',
          this.redisConfiguration.metricsRetentionMs,
        );
      }

      const results = await pipeline.exec();

      results?.forEach(([error], index) => {
        const entry = entries.at(index);

        if (error !== null && entry !== undefined) {
          const [key, value] = entry;

          this.logger.warn({ key, value }, FAILED_METRICS_ENTRY_LOG_MESSAGE, error);
        }
      });
    } catch (error) {
      this.logger.warn({ entries }, FAILED_METRICS_LOG_MESSAGE, error);
    }
  }

  private readonly logger: AppLogger;
}
