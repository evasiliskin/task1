import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type Redis } from 'ioredis';

import { REDIS_CLIENT } from '../infra/client-tokens.js';
import { LoggerAware } from '../logger/logger-aware.base.js';
import { LoggerService } from '../logger/rmq/logger.service.js';

@Injectable()
export class RedisConnectionService extends LoggerAware implements OnModuleInit, OnModuleDestroy {
  public constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    loggerService: LoggerService,
  ) {
    super(loggerService);
  }

  public async onModuleInit(): Promise<void> {
    await this.client.connect();

    this.logger.info({}, 'Connected to Redis');
  }

  public async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
