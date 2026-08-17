import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { RequestContextService } from '../request-context.service.js';

import { ContextPropagatingClient } from './context-propagating.client.js';
import { RmqContextInterceptor } from './rmq-context.interceptor.js';

@Global()
@Module({
  providers: [
    RequestContextService,
    ContextPropagatingClient,
    { provide: APP_INTERCEPTOR, useClass: RmqContextInterceptor },
  ],
  exports: [RequestContextService, ContextPropagatingClient],
})
export class RequestContextModule {}
