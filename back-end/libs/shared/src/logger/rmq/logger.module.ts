import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { RequestContextModule } from '../../request-context/rmq/request-context.module.js';
import { LoggerCoreModule } from '../logger-core.module.js';

import { RmqLoggingInterceptor } from './rmq-logging.interceptor.js';

@Module({
  // RequestContextModule is imported first so its RmqContextInterceptor is registered ahead of
  // RmqLoggingInterceptor — the correlation id must be in the ALS store before anything logs.
  imports: [RequestContextModule, LoggerCoreModule.forChannel('rmq')],
  providers: [{ provide: APP_INTERCEPTOR, useClass: RmqLoggingInterceptor }],
  exports: [LoggerCoreModule],
})
export class LoggerModule {}
