import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type Redis } from 'ioredis';

import { REDIS_CLIENT } from '../infra/client-tokens.js';
import { LoggerService } from '../logger/rmq/logger.service.js';

@Injectable()
export class RedisConnectionService implements OnModuleInit, OnModuleDestroy {
  public constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    private readonly loggerService: LoggerService,
  ) {}

  public async onModuleInit(): Promise<void> {
    await this.client.connect();

    this.loggerService.getLogger('RedisConnectionService').info({}, 'Connected to Redis');
  }

  public async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
