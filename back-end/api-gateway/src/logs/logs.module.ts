import { Module } from '@nestjs/common';

import { LogsController } from './logs.controller.js';

@Module({
  controllers: [LogsController],
})
export class LogsModule {}
