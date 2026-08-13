import { Module } from '@nestjs/common';
import { LoggerModule } from '@task1/shared/logger/rmq/logger.module';

import { EnsureProcessingLogIndexesInitializer } from './ensure-processing-log-indexes-initializer.service.js';
import { ImportEventsController } from './import-events.controller.js';
import { processingLogCollectionProvider } from './processing-log-collection.provider.js';
import { ProcessingLogTracker } from './processing-log-tracker.service.js';
import { LogsSearchController } from './search/logs-search.controller.js';
import { LogsSearchService } from './search/logs-search.service.js';

@Module({
  imports: [LoggerModule],
  controllers: [ImportEventsController, LogsSearchController],
  providers: [
    processingLogCollectionProvider,
    EnsureProcessingLogIndexesInitializer,
    ProcessingLogTracker,
    LogsSearchService,
  ],
})
export class ProcessingLogModule {}
