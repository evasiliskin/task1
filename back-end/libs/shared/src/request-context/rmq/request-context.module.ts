import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { RequestContextService } from '../request-context.service';

import { RmqContextInterceptor } from './rmq-context.interceptor';

@Global()
@Module({
  providers: [RequestContextService, { provide: APP_INTERCEPTOR, useClass: RmqContextInterceptor }],
  exports: [RequestContextService],
})
export class RequestContextModule {}
