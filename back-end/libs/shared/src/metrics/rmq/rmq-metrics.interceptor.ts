import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type RmqContext } from '@nestjs/microservices';
import { type Observable, tap } from 'rxjs';

import loggerConfig, { type ILoggerConfiguration } from '../../config/logger.config.js';
import { RPC_PATTERNS } from '../../messaging/rpc-patterns.const.js';
import { buildErrorMetricKey, buildRequestMetricKey } from '../metric-key.util.js';
import { MetricsService } from '../metrics.service.js';

const UNMETERED_PATTERNS: ReadonlySet<string> = new Set([RPC_PATTERNS.HEALTH_CHECK]);

@Injectable()
export class RmqMetricsInterceptor implements NestInterceptor {
  public constructor(
    private readonly metricsService: MetricsService,
    @Inject(loggerConfig.KEY) loggerConfiguration: ILoggerConfiguration,
  ) {
    this.serviceName = loggerConfiguration.serviceName;
  }

  public intercept(executionContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    const pattern = executionContext.switchToRpc().getContext<RmqContext>().getPattern();

    if (UNMETERED_PATTERNS.has(pattern)) {
      return next.handle();
    }

    // eslint-disable-next-line no-void -- Not awaited: a Redis round trip must not sit on the message-handling latency path, and `recordMetric` already handles and logs its own failures.
    void this.metricsService.recordMetric(buildRequestMetricKey(this.serviceName, pattern), 1);

    return next.handle().pipe(
      tap({
        error: () => {
          // eslint-disable-next-line no-void -- Same reason as above; a metrics failure must never mask the handler's own error.
          void this.metricsService.recordMetric(buildErrorMetricKey(this.serviceName, pattern), 1);
        },
      }),
    );
  }

  private readonly serviceName: string;
}
