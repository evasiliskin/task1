import { Module } from '@nestjs/common';
import { LoggerModule } from '@task1/shared/logger/rmq/logger.module';

import { EnsureEventIndexesInitializer } from './ensure-event-indexes-initializer.service.js';
import { eventsCollectionProvider } from './events-collection.provider.js';
import { EventsSearchController } from './search/events-search.controller.js';
import { EventsSearchService } from './search/events-search.service.js';
import { ArchiveProcessingService } from './upload/archive-processing.service.js';
import { UploadImportController } from './upload/upload-import.controller.js';

@Module({
  imports: [LoggerModule],
  controllers: [UploadImportController, EventsSearchController],
  providers: [
    eventsCollectionProvider,
    EnsureEventIndexesInitializer,
    ArchiveProcessingService,
    EventsSearchService,
  ],
})
export class ArchiveModule {}
