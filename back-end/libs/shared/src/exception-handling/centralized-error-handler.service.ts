import { Inject, Injectable } from '@nestjs/common';

import { FatalError } from '../errors/index.js';
import { type AppLogger } from '../logger/app-logger.js';
import { type LogFields } from '../logger/types.js';

import { CENTRALIZED_ERROR_LOGGER } from './centralized-error-handler.tokens.js';

const FORCED_EXIT_DELAY_MS = 5000;

@Injectable()
export class CentralizedErrorHandlerService {
  public constructor(@Inject(CENTRALIZED_ERROR_LOGGER) private readonly logger: AppLogger) {}

  public handleError(error: unknown): void {
    const isFatal = error instanceof FatalError;
    const fields = this.buildFields(error);
    const message = this.buildMessage(error, isFatal);

    if (isFatal) {
      this.logger.fatal(fields, message);

      // Signal failure without killing the process synchronously: an immediate
      // process.exit() drops pino's worker-thread transport buffer and skips
      // Nest's shutdown hooks, severing Mongo/Redis/RabbitMQ mid-operation.
      process.exitCode = 1;
      process.emit('SIGTERM');

      // Backstop: if shutdown hangs, force the exit rather than hanging forever.
      // eslint-disable-next-line n/no-process-exit -- last-resort backstop after graceful shutdown failed to complete.
      setTimeout(() => process.exit(1), FORCED_EXIT_DELAY_MS).unref();

      return;
    }

    this.logger.error(fields, message);
  }

  private buildFields(error: unknown): LogFields {
    if (error instanceof Error) {
      return { name: error.name, message: error.message, stack: error.stack };
    }

    return { value: String(error) };
  }

  private buildMessage(error: unknown, isFatal: boolean): string {
    const detail = error instanceof Error ? error.message : String(error);

    return isFatal ? `Fatal error: ${detail}` : detail;
  }
}
