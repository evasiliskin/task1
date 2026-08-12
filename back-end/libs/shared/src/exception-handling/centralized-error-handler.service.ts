import { Inject, Injectable } from '@nestjs/common';

import { type AppLogger } from '../logger/app-logger';
import { type LogFields } from '../logger/types';

import { CENTRALIZED_ERROR_LOGGER } from './centralized-error-handler.tokens';

/**
 * Handles process-level fatal errors (uncaughtException / unhandledRejection).
 * Process state is unreliable once one of these fires, so after logging it
 * always terminates the process — see ProcessErrorHandlerService for registration.
 */
@Injectable()
export class CentralizedErrorHandlerService {
  public constructor(@Inject(CENTRALIZED_ERROR_LOGGER) private readonly logger: AppLogger) {}

  public handleFatalError(error: unknown): void {
    this.logger.fatal(this.buildFields(error), this.buildMessage(error));

    // eslint-disable-next-line n/no-process-exit -- process state is unreliable after an uncaught exception; must exit per nodejsbestpractices
    process.exit(1);
  }

  private buildFields(error: unknown): LogFields {
    if (error instanceof Error) {
      return { name: error.name, message: error.message, stack: error.stack };
    }

    return { value: String(error) };
  }

  private buildMessage(error: unknown): string {
    return error instanceof Error
      ? `Fatal error: ${error.message}`
      : `Fatal error: ${String(error)}`;
  }
}
