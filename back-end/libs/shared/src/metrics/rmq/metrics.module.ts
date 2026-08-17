import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { LoggerModule } from '../../logger/rmq/logger.module.js';
import { MetricsService } from '../metrics.service.js';

import { RmqMetricsInterceptor } from './rmq-metrics.interceptor.js';

@Module({
  imports: [LoggerModule],
  providers: [MetricsService, { provide: APP_INTERCEPTOR, useClass: RmqMetricsInterceptor }],
  exports: [MetricsService],
})
export class MetricsModule {}
