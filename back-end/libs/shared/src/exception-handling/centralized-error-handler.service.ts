import { Inject, Injectable, Optional } from '@nestjs/common';

import { FatalError } from '../errors/index.js';
import { type AppLogger } from '../logger/app-logger.js';
import { PINO_DESTINATION } from '../logger/logger.tokens.js';
import { type IFlushableDestination } from '../logger/pino-destination.factory.js';
import { type LogFields } from '../logger/types.js';
import { type IRequestContext } from '../request-context/request-context.types.js';

import { CENTRALIZED_ERROR_LOGGER } from './centralized-error-handler.tokens.js';

const FORCED_EXIT_DELAY_MS = 5000;

@Injectable()
export class CentralizedErrorHandlerService {
  public constructor(
    @Inject(CENTRALIZED_ERROR_LOGGER) private readonly logger: AppLogger,
    @Optional() @Inject(PINO_DESTINATION) private readonly destination?: IFlushableDestination,
  ) {}

  /**
   * `context` exists because `process.on('uncaughtException')` runs outside the AsyncLocalStorage
   * store that raised the error, so pino's mixin contributes nothing and the most severe line the
   * system emits would otherwise be the only untraceable one. `ProcessErrorHandlerService`
   * captures the store at throw time and hands it back here.
   */
  public handleError(error: unknown, context?: Partial<IRequestContext>): void {
    const isFatal = error instanceof FatalError;
    const fields: LogFields = { ...context };
    const message = this.buildMessage(error, isFatal);

    if (isFatal) {
      // The error goes through the third argument, not into a field: that is the only route to
      // pino's `err` serializer, which walks FatalError's `cause` — where the real failure lives.
      this.logger.fatal(fields, message, error);

      // Buffered logging trades a crash-loss window for not blocking the event loop. A fatal line
      // must not be inside that window.
      this.destination?.flushSync();

      // Signal failure without killing the process synchronously: an immediate
      // process.exit() drops pino's buffer and skips Nest's shutdown hooks,
      // severing Mongo/Redis/RabbitMQ mid-operation.
      process.exitCode = 1;
      process.emit('SIGTERM');

      // Backstop: if shutdown hangs, force the exit rather than hanging forever — flushing again
      // first, because lines written during the failed shutdown are still buffered.
      setTimeout(() => {
        this.destination?.flushSync();
        // eslint-disable-next-line n/no-process-exit -- last-resort backstop after graceful shutdown failed to complete.
        process.exit(1);
      }, FORCED_EXIT_DELAY_MS).unref();

      return;
    }

    this.logger.error(fields, message, error);
  }

  private buildMessage(error: unknown, isFatal: boolean): string {
    const detail = error instanceof Error ? error.message : String(error);

    return isFatal ? `Fatal error: ${detail}` : detail;
  }
}
