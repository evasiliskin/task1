import { Module } from '@nestjs/common';

import { ProcessingLogModule } from '../processing-log/processing-log.module.js';

import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [ProcessingLogModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
