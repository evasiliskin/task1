import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { LoggerAware } from '@task1/shared/logger/logger-aware.base';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Collection } from 'mongodb';

import { EVENTS_COLLECTION } from './events-collection.provider.js';
import { ensureEventIndexes } from './processing/ensure-event-indexes.js';

@Injectable()
export class EnsureEventIndexesInitializer extends LoggerAware implements OnModuleInit {
  public constructor(
    @Inject(EVENTS_COLLECTION) private readonly collection: Collection<IGithubEventDocument>,
    loggerService: LoggerService,
  ) {
    super(loggerService);
  }

  public async onModuleInit(): Promise<void> {
    await ensureEventIndexes(this.collection);

    this.logger.info({}, 'Ensured events collection indexes');
  }
}
