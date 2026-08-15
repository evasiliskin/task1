import { Inject, Injectable, type OnApplicationShutdown, Optional } from '@nestjs/common';

import { PINO_DESTINATION } from './logger.tokens.js';
import { type IFlushableDestination } from './pino-destination.factory.js';

/**
 * Buffered logging trades a small crash-loss window for not blocking the event loop. This hook
 * closes that window for every ordinary shutdown — `app.enableShutdownHooks()` is already called
 * in all three `main.ts` files.
 */
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
