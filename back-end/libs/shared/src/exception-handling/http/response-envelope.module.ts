import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor.js';

/**
 * Must be imported BEFORE ContractModule. NestJS unwinds interceptors in reverse
 * registration order, so registering this one first makes its response mapping run
 * last — after ContractValidationInterceptor has validated the unwrapped payload.
 */
@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor }],
})
export class ResponseEnvelopeModule {}
