import { Module } from '@nestjs/common';
import { LoggerModule } from '@task1/shared/logger/http/logger.module';

import { ReportsController } from './reports.controller.js';

@Module({
  imports: [LoggerModule],
  controllers: [ReportsController],
})
export class ReportsModule {}
