import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { type RmqContext } from '@nestjs/microservices';
import { firstValueFrom, Observable, of } from 'rxjs';

import { RequestContextService } from '../request-context.service';

import { RmqContextInterceptor } from './rmq-context.interceptor';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('RmqContextInterceptor', () => {
  let interceptor: RmqContextInterceptor;
  let requestContextService: RequestContextService;

  beforeEach(() => {
    requestContextService = new RequestContextService();
    interceptor = new RmqContextInterceptor(requestContextService);
  });

  const buildExecutionContext = (headers: Record<string, string>): ExecutionContext => {
    const rmqContext = { getMessage: () => ({ properties: { headers } }) } as unknown as RmqContext;

    return {
      switchToRpc: () => ({ getContext: <T>() => rmqContext as T }),
    } as unknown as ExecutionContext;
  };

  it('should extract and reuse valid correlation id and request id headers', async () => {
    const executionContext = buildExecutionContext({
      'x-correlation-id': '11111111-1111-4111-8111-111111111111',
      'x-request-id': '22222222-2222-4222-8222-222222222222',
    });
    let observedContext: Partial<{ correlationId: string; requestId: string }> = {};
    const callHandler: CallHandler = {
      handle: () => {
        observedContext = requestContextService.getAttributes();

        return of(null);
      },
    };

    await firstValueFrom(interceptor.intercept(executionContext, callHandler));

    expect(observedContext).toEqual({
      correlationId: '11111111-1111-4111-8111-111111111111',
      requestId: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('should generate valid UUID v4 ids, when headers are absent', async () => {
    const executionContext = buildExecutionContext({});
    let observedContext: Partial<{ correlationId: string; requestId: string }> = {};
    const callHandler: CallHandler = {
      handle: () => {
        observedContext = requestContextService.getAttributes();

        return of(null);
      },
    };

    await firstValueFrom(interceptor.intercept(executionContext, callHandler));

    expect(observedContext.correlationId).toMatch(UUID_V4_PATTERN);
    expect(observedContext.requestId).toMatch(UUID_V4_PATTERN);
  });

  it('should generate valid UUID v4 ids, when headers are invalid', async () => {
    const executionContext = buildExecutionContext({
      'x-correlation-id': '',
      'x-request-id': '   ',
    });
    let observedContext: Partial<{ correlationId: string; requestId: string }> = {};
    const callHandler: CallHandler = {
      handle: () => {
        observedContext = requestContextService.getAttributes();

        return of(null);
      },
    };

    await firstValueFrom(interceptor.intercept(executionContext, callHandler));

    expect(observedContext.correlationId).toMatch(UUID_V4_PATTERN);
    expect(observedContext.requestId).toMatch(UUID_V4_PATTERN);
  });

  it('should emit the value produced by the handler', async () => {
    const executionContext = buildExecutionContext({});
    const callHandler: CallHandler = { handle: () => of({ status: 'ok' }) };

    const result = await firstValueFrom(interceptor.intercept(executionContext, callHandler));

    expect(result).toEqual({ status: 'ok' });
  });

  it('should propagate an error emitted by the handler', async () => {
    const executionContext = buildExecutionContext({});
    const callHandler: CallHandler = {
      handle: () =>
        new Observable((subscriber) => {
          subscriber.error(new Error('handler failed'));
        }),
    };

    await expect(
      firstValueFrom(interceptor.intercept(executionContext, callHandler)),
    ).rejects.toThrow('handler failed');
  });
});
