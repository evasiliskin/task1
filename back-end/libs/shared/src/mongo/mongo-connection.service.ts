import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type MongoClient } from 'mongodb';

import { MONGO_CLIENT } from '../infra/client-tokens.js';
import { type AppLogger } from '../logger/app-logger.js';
import { type ILoggerFactory } from '../logger/logger-factory.interface.js';
import { LOGGER_FACTORY } from '../logger/logger.tokens.js';

@Injectable()
export class MongoConnectionService implements OnModuleInit, OnModuleDestroy {
  public constructor(
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
    @Inject(LOGGER_FACTORY) loggerFactory: ILoggerFactory,
  ) {
    this.logger = loggerFactory.getLogger(MongoConnectionService.name);
  }

  public async onModuleInit(): Promise<void> {
    await this.client.connect();

    this.logger.info({}, 'Connected to MongoDB');
  }

  public async onModuleDestroy(): Promise<void> {
    await this.client.close();
  }

  private readonly logger: AppLogger;
}
