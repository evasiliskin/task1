import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type RmqContext } from '@nestjs/microservices';
import { type Observable, tap } from 'rxjs';

import { RPC_PATTERNS } from '../../messaging/rpc-patterns.const.js';
import { RequestContextService } from '../../request-context/request-context.service.js';
import { type AppLogger } from '../app-logger.js';
import { LoggerService } from '../logger.service.js';
import { truncateForLog } from '../truncate.util.js';

export const MESSAGE_RECEIVED_LOG = 'message received';
export const MESSAGE_HANDLED_LOG = 'message handled';
export const MESSAGE_FAILED_LOG = 'message failed';
export const MESSAGE_DETAIL_LOG = 'message detail';
export const BROKEN_TRACE_LOG =
  'inbound message carried no correlation id; the trace chain is broken at this hop';

/**
 * Patterns that are never logged. The health pattern is polled by the gateway's own dependency
 * checks and by any external monitor, so logging it would bury real traffic — the same reason
 * `HttpLoggingMiddleware` excludes `/health`.
 */
const UNLOGGED_PATTERNS: ReadonlySet<string> = new Set([RPC_PATTERNS.HEALTH_CHECK]);

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
    const rpc = executionContext.switchToRpc();
    const pattern = rpc.getContext<RmqContext>().getPattern();

    if (UNLOGGED_PATTERNS.has(pattern)) {
      return next.handle();
    }

    const startedAt = Date.now();

    if (this.requestContextService.getAttributes().correlationIdSource === 'generated') {
      this.logger.warn({ pattern }, BROKEN_TRACE_LOG);
    }

    this.logger.info({ pattern }, MESSAGE_RECEIVED_LOG);

    // The payload is *detail*: emitted only at debug, and only when that level is actually
    // enabled, so raising the level under load sheds the serialization cost and not just the
    // output. `redactLogPayload` still runs inside AppLogger.write, so this is redacted for free.
    if (this.logger.isLevelEnabled('debug')) {
      this.logger.debug({ pattern, payload: truncateForLog(rpc.getData()) }, MESSAGE_DETAIL_LOG);
    }

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
