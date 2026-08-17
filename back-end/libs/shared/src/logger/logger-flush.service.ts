import { Inject, Injectable, type OnApplicationShutdown, Optional } from '@nestjs/common';

import { PINO_DESTINATION } from './logger.tokens.js';
import { type IFlushableDestination } from './pino-destination.factory.js';

@Injectable()
export class LoggerFlushService implements OnApplicationShutdown {
  public constructor(
    @Optional()
    @Inject(PINO_DESTINATION)
    private readonly destination?: IFlushableDestination,
  ) {}

  public onApplicationShutdown(): void {
    this.destination?.flushSync();
  }
}
