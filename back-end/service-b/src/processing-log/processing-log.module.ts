import { Module } from '@nestjs/common';
import { LoggerModule } from '@task1/shared/logger/rmq/logger.module';

import { EnsureProcessingLogIndexesInitializer } from './ensure-processing-log-indexes-initializer.service.js';
import { ImportEventsController } from './import-events.controller.js';
import { processingLogCollectionProvider } from './processing-log-collection.provider.js';
import { ProcessingLogTracker } from './processing-log-tracker.service.js';
import { LogsSearchController } from './search/logs-search.controller.js';
import { LogsSearchService } from './search/logs-search.service.js';
import { StatsMetricsReader } from './stats/stats-metrics-reader.service.js';
import { StatsController } from './stats/stats.controller.js';
import { StatsService } from './stats/stats.service.js';

@Module({
  imports: [LoggerModule],
  controllers: [ImportEventsController, LogsSearchController, StatsController],
  providers: [
    processingLogCollectionProvider,
    EnsureProcessingLogIndexesInitializer,
    ProcessingLogTracker,
    LogsSearchService,
    StatsMetricsReader,
    StatsService,
  ],
  exports: [StatsService],
})
export class ProcessingLogModule {}
