import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type MongoClient } from 'mongodb';

import { MONGO_CLIENT } from '../infra/client-tokens.js';
import { LoggerAware } from '../logger/logger-aware.base.js';
import { LoggerService } from '../logger/rmq/logger.service.js';

@Injectable()
export class MongoConnectionService extends LoggerAware implements OnModuleInit, OnModuleDestroy {
  public constructor(
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
    loggerService: LoggerService,
  ) {
    super(loggerService);
  }

  public async onModuleInit(): Promise<void> {
    await this.client.connect();

    this.logger.info({}, 'Connected to MongoDB');
  }

  public async onModuleDestroy(): Promise<void> {
    await this.client.close();
  }
}
