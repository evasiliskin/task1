import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type RmqContext } from '@nestjs/microservices';
import { Observable, type Subscription } from 'rxjs';

import { RequestContextService } from '../request-context.service.js';
import { resolveRequestContext } from '../resolve-request-context.util.js';

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
    const context = resolveRequestContext(headers);

    return new Observable((subscriber) => {
      let subscription: Subscription | undefined;

      this.requestContextService.run(context, () => {
        subscription = next.handle().subscribe(subscriber);
      });

      return () => subscription?.unsubscribe();
    });
  }
}
