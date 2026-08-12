import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type RmqContext } from '@nestjs/microservices';
import { Observable, type Subscription } from 'rxjs';

import { resolveId } from './id-validation.util';
import { RequestContextService } from './request-context.service';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from './request-context.types';

interface IRmqMessage {
  properties: { headers?: Record<string, string | string[] | undefined> };
}

@Injectable()
export class RmqContextInterceptor implements NestInterceptor {
  public constructor(private readonly requestContextService: RequestContextService) {}

  public intercept(executionContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    const rmqContext = executionContext.switchToRpc().getContext<RmqContext>();
    const message = rmqContext.getMessage() as IRmqMessage;
    const headers = message.properties.headers ?? {};
    // eslint-disable-next-line security/detect-object-injection
    const correlationId = resolveId(headers[CORRELATION_ID_HEADER]);
    // eslint-disable-next-line security/detect-object-injection
    const requestId = resolveId(headers[REQUEST_ID_HEADER]);

    return new Observable((subscriber) => {
      let subscription: Subscription | undefined;

      this.requestContextService.run({ correlationId, requestId }, () => {
        subscription = next.handle().subscribe(subscriber);
      });

      return () => subscription?.unsubscribe();
    });
  }
}
