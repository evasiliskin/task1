import { Global, Module } from '@nestjs/common';

import { RequestContextService } from '../request-context.service.js';
import { ContextPropagatingClient } from '../rmq/context-propagating.client.js';

@Global()
@Module({
  providers: [RequestContextService, ContextPropagatingClient],
  exports: [RequestContextService, ContextPropagatingClient],
})
export class RequestContextModule {}
