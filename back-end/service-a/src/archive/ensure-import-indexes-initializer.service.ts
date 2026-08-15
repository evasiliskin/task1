import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/logger.service';
import { type Collection } from 'mongodb';

import { ensureImportIndexes } from './ensure-import-indexes.js';
import { type IImportRunDocument } from './import-run.types.js';
import { IMPORTS_COLLECTION } from './imports-collection.provider.js';

@Injectable()
export class EnsureImportIndexesInitializer implements OnModuleInit {
  public constructor(
    @Inject(IMPORTS_COLLECTION) private readonly collection: Collection<IImportRunDocument>,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger(EnsureImportIndexesInitializer.name);
  }

  public async onModuleInit(): Promise<void> {
    await ensureImportIndexes(this.collection);

    this.logger.info({}, 'Ensured imports collection indexes');
  }

  private readonly logger: AppLogger;
}
