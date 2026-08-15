import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/logger.service';
import { type Collection } from 'mongodb';

import { EVENTS_COLLECTION } from './events-collection.provider.js';
import { ensureEventIndexes } from './processing/ensure-event-indexes.js';

@Injectable()
export class EnsureEventIndexesInitializer implements OnModuleInit {
  public constructor(
    @Inject(EVENTS_COLLECTION) private readonly collection: Collection<IGithubEventDocument>,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger(EnsureEventIndexesInitializer.name);
  }

  public async onModuleInit(): Promise<void> {
    await ensureEventIndexes(this.collection);

    this.logger.info({}, 'Ensured events collection indexes');
  }

  private readonly logger: AppLogger;
}
