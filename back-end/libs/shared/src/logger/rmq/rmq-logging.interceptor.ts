import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type RmqContext } from '@nestjs/microservices';
import { type Observable, tap } from 'rxjs';

import { RequestContextService } from '../../request-context/request-context.service.js';
import { type AppLogger } from '../app-logger.js';
import { LoggerService } from '../logger.service.js';

export const MESSAGE_RECEIVED_LOG = 'message received';
export const MESSAGE_HANDLED_LOG = 'message handled';
export const MESSAGE_FAILED_LOG = 'message failed';
export const BROKEN_TRACE_LOG =
  'inbound message carried no correlation id; the trace chain is broken at this hop';

/**
 * The RMQ counterpart of `HttpLoggingMiddleware`: one owner for consumer lifecycle logging, so a
 * message's receipt, outcome and duration are visible without every handler writing its own lines.
 *
 * Must be registered after `RmqContextInterceptor` so `correlationId` is already in the ALS store.
 */
@Injectable()
export class RmqLoggingInterceptor implements NestInterceptor {
  public constructor(
    loggerService: LoggerService,
    private readonly requestContextService: RequestContextService,
  ) {
    this.logger = loggerService.getLogger(RmqLoggingInterceptor.name, 'rmq');
  }

  public intercept(executionContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    const pattern = executionContext.switchToRpc().getContext<RmqContext>().getPattern();
    const startedAt = Date.now();

    if (this.requestContextService.getAttributes().correlationIdSource === 'generated') {
      this.logger.warn({ pattern }, BROKEN_TRACE_LOG);
    }

    this.logger.info({ pattern }, MESSAGE_RECEIVED_LOG);

    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.info({ pattern, durationMs: Date.now() - startedAt }, MESSAGE_HANDLED_LOG);
        },
        error: (error: unknown) => {
          this.logger.error(
            { pattern, durationMs: Date.now() - startedAt },
            MESSAGE_FAILED_LOG,
            error,
          );
        },
      }),
    );
  }

  private readonly logger: AppLogger;
}
