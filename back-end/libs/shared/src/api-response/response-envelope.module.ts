import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor.js';

@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor }],
})
export class ResponseEnvelopeModule {}
