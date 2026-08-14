import { Inject, Injectable } from '@nestjs/common';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Redis } from 'ioredis';

import redisConfig, { type RedisConfiguration } from '../../config/redis.config.js';
import { REDIS_CLIENT } from '../infra-clients.tokens.js';

const AUTOMATIC_TIMESTAMP = '*';
const FAILED_METRIC_LOG_MESSAGE = 'Failed to record metric';

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
      this.logger.warn(
        { key, value, error: error instanceof Error ? error.message : String(error) },
        FAILED_METRIC_LOG_MESSAGE,
      );
    }
  }

  private readonly logger: AppLogger;
}
