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

  public handleError(error: unknown, context?: Partial<IRequestContext>): void {
    const isFatal = error instanceof FatalError;
    const fields: LogFields = { ...context };
    const message = this.buildMessage(error, isFatal);

    if (isFatal) {
      this.logger.fatal(fields, message, error);

      this.destination?.flushSync();

      process.exitCode = 1;
      process.emit('SIGTERM');

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
