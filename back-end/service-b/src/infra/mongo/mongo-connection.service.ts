import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type MongoClient } from 'mongodb';

import { MONGO_CLIENT } from '../infra-clients.tokens.js';

@Injectable()
export class MongoConnectionService implements OnModuleInit, OnModuleDestroy {
  public constructor(
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
    private readonly loggerService: LoggerService,
  ) {}

  public async onModuleInit(): Promise<void> {
    await this.client.connect();

    this.loggerService.getLogger('MongoConnectionService').info({}, 'Connected to MongoDB');
  }

  public async onModuleDestroy(): Promise<void> {
    await this.client.close();
  }
}
