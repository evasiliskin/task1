import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { type Redis } from 'ioredis';

import { REDIS_CLIENT } from '../infra/client-tokens.js';
import { type AppLogger } from '../logger/app-logger.js';
import { type ILoggerFactory } from '../logger/logger-factory.interface.js';
import { LOGGER_FACTORY } from '../logger/logger.tokens.js';

@Injectable()
export class RedisConnectionService implements OnModuleInit, OnApplicationShutdown {
  public constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    @Inject(LOGGER_FACTORY) loggerFactory: ILoggerFactory,
  ) {
    this.logger = loggerFactory.getLogger(RedisConnectionService.name);
  }

  public async onModuleInit(): Promise<void> {
    await this.client.connect();

    this.logger.info({}, 'Connected to Redis');
  }

  /**
   * `onApplicationShutdown`, not `onModuleDestroy`: Nest runs `onModuleDestroy` first, which used
   * to close the client while an import was still writing. Shutdown order is now drain
   * (`onModuleDestroy`) → stop consuming (dispose) → close connections (here).
   */
  public async onApplicationShutdown(): Promise<void> {
    await this.client.quit();
  }

  private readonly logger: AppLogger;
}
