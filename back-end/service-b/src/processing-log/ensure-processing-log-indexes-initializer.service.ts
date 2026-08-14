import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Collection } from 'mongodb';

import { ensureProcessingLogIndexes } from './ensure-processing-log-indexes.js';
import { PROCESSING_LOG_COLLECTION } from './processing-log-collection.provider.js';
import { type IProcessingLogDocument } from './processing-log.types.js';

@Injectable()
export class EnsureProcessingLogIndexesInitializer implements OnModuleInit {
  public constructor(
    @Inject(PROCESSING_LOG_COLLECTION)
    private readonly collection: Collection<IProcessingLogDocument>,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger('EnsureProcessingLogIndexesInitializer');
  }

  public async onModuleInit(): Promise<void> {
    await ensureProcessingLogIndexes(this.collection);

    this.logger.info({}, 'Ensured processing-logs collection indexes');
  }

  private readonly logger: AppLogger;
}
