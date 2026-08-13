import { Inject, Injectable } from '@nestjs/common';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Redis } from 'ioredis';

import redisConfig, { type RedisConfiguration } from '../../config/redis.config.js';
import { REDIS_CLIENT } from '../../infra/infra-clients.tokens.js';

import { type IImportTimeSeriesPoint } from './derive-import-duration-stats.js';

const METRIC_PROCESSING_DURATION = 'service_a.archive.processing.duration';
const METRIC_EVENTS_PROCESSED = 'service_a.archive.events.processed';
const MAX_TIME_SERIES_POINTS = 50;
const FAILED_READ_DURATION_LOG = 'Failed to read average processing duration metric';
const FAILED_READ_TIME_SERIES_LOG = 'Failed to read events-processed time series metric';

type TsRangeReply = [number, string][];

@Injectable()
export class StatsMetricsReader {
  public constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    @Inject(redisConfig.KEY) private readonly redisConfiguration: RedisConfiguration,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger('StatsMetricsReader');
  }

  public async readAverageProcessingDuration(): Promise<number | undefined> {
    try {
      const reply = (await this.client.call(
        'TS.RANGE',
        METRIC_PROCESSING_DURATION,
        '-',
        '+',
        'AGGREGATION',
        'avg',
        this.redisConfiguration.metricsRetentionMs,
      )) as TsRangeReply;

      const lastSample = reply.at(-1);

      return lastSample === undefined ? undefined : Number(lastSample[1]);
    } catch (error) {
      this.logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        FAILED_READ_DURATION_LOG,
      );

      return undefined;
    }
  }

  public async readEventsTimeSeries(): Promise<IImportTimeSeriesPoint[]> {
    const bucketMs = Math.ceil(this.redisConfiguration.metricsRetentionMs / MAX_TIME_SERIES_POINTS);

    try {
      const reply = (await this.client.call(
        'TS.RANGE',
        METRIC_EVENTS_PROCESSED,
        '-',
        '+',
        'AGGREGATION',
        'avg',
        bucketMs,
      )) as TsRangeReply;

      return reply.map(([timestamp, value]) => ({
        timestamp: new Date(timestamp).toISOString(),
        value: Number(value),
      }));
    } catch (error) {
      this.logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        FAILED_READ_TIME_SERIES_LOG,
      );

      return [];
    }
  }

  private readonly logger: AppLogger;
}
