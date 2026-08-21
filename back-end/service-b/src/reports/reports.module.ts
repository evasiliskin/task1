import { Module } from '@nestjs/common';
import { LoggerModule } from '@task1/shared/logger/rmq/logger.module';

import { ProcessingLogModule } from '../processing-log/processing-log.module.js';

import { ReportCleanupService } from './report-cleanup.service.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [ProcessingLogModule, LoggerModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportCleanupService],
})
export class ReportsModule {}
