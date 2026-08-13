import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { LoggerModule } from '@task1/shared/logger/rmq/logger.module';

import rabbitmqConfig from '../config/rabbitmq.config.js';

import { ArchiveDownloadService } from './download/archive-download.service.js';
import { DownloadImportController } from './download/download-import.controller.js';
import { EnsureEventIndexesInitializer } from './ensure-event-indexes-initializer.service.js';
import { EnsureImportIndexesInitializer } from './ensure-import-indexes-initializer.service.js';
import { eventsCollectionProvider } from './events-collection.provider.js';
import { ImportOrchestrationService } from './import-orchestration.service.js';
import { ImportRunTracker } from './import-run-tracker.service.js';
import { importsCollectionProvider } from './imports-collection.provider.js';
import { SERVICE_B_RMQ_CLIENT } from './rabbitmq-client.token.js';
import { EventsSearchController } from './search/events-search.controller.js';
import { EventsSearchService } from './search/events-search.service.js';
import { ArchiveProcessingService } from './upload/archive-processing.service.js';
import { UploadImportController } from './upload/upload-import.controller.js';

@Module({
  imports: [
    LoggerModule,
    ClientsModule.registerAsync([
      {
        name: SERVICE_B_RMQ_CLIENT,
        inject: [rabbitmqConfig.KEY],
        useFactory: (config: ConfigType<typeof rabbitmqConfig>) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.url],
            queue: config.serviceBQueue,
            queueOptions: { durable: true },
          },
        }),
      },
    ]),
  ],
  controllers: [UploadImportController, DownloadImportController, EventsSearchController],
  providers: [
    eventsCollectionProvider,
    importsCollectionProvider,
    EnsureEventIndexesInitializer,
    EnsureImportIndexesInitializer,
    ArchiveProcessingService,
    ArchiveDownloadService,
    ImportRunTracker,
    ImportOrchestrationService,
    EventsSearchService,
  ],
})
export class ArchiveModule {}
