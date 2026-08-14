import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { LoggerAware } from '@task1/shared/logger/logger-aware.base';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Collection } from 'mongodb';

import { ensureImportIndexes } from './ensure-import-indexes.js';
import { type IImportRunDocument } from './import-run.types.js';
import { IMPORTS_COLLECTION } from './imports-collection.provider.js';

@Injectable()
export class EnsureImportIndexesInitializer extends LoggerAware implements OnModuleInit {
  public constructor(
    @Inject(IMPORTS_COLLECTION) private readonly collection: Collection<IImportRunDocument>,
    loggerService: LoggerService,
  ) {
    super(loggerService);
  }

  public async onModuleInit(): Promise<void> {
    await ensureImportIndexes(this.collection);

    this.logger.info({}, 'Ensured imports collection indexes');
  }
}
