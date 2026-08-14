import { type ExecutionContext, StreamableFile } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';

import { listResult } from '../pagination/list-result.js';
import { RequestContextService } from '../request-context/request-context.service.js';

import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor.js';

const CORRELATION_ID = '2f1fdc5d-4324-4f56-95ae-d25df842bd7b';

function contextWithStatus(statusCode: number): ExecutionContext {
  return {
    switchToHttp: () => ({ getResponse: () => ({ statusCode }) }),
  } as unknown as ExecutionContext;
}

describe('ResponseEnvelopeInterceptor', () => {
  let requestContextService: RequestContextService;
  let interceptor: ResponseEnvelopeInterceptor;

  beforeEach(() => {
    requestContextService = new RequestContextService();
    interceptor = new ResponseEnvelopeInterceptor(requestContextService);
  });

  it('should wrap the payload in a success envelope, when the handler returns an object', async () => {
    const result = await requestContextService.run(
      { correlationId: CORRELATION_ID, requestId: 'r-1' },
      async () =>
        await firstValueFrom(
          interceptor.intercept(contextWithStatus(200), { handle: () => of({ importId: 'abc' }) }),
        ),
    );

    expect(result).toEqual({
      status: 'SUCCESS',
      code: 200,
      message: 'OK',
      result: { data: { importId: 'abc' } },
      meta: { tracing: { correlationId: CORRELATION_ID } },
    });
  });

  it('should emit items and pagination, when the handler returns a list result', async () => {
    const result = await requestContextService.run(
      { correlationId: CORRELATION_ID, requestId: 'r-1' },
      async () =>
        await firstValueFrom(
          interceptor.intercept(contextWithStatus(200), {
            handle: () => of(listResult([{ id: '1' }], { nextCursor: 'abc' })),
          }),
        ),
    );

    expect((result as { result: unknown }).result).toEqual({
      items: [{ id: '1' }],
      pagination: { nextCursor: 'abc' },
    });
  });

  it('should return the file untouched, when the handler returns a StreamableFile', async () => {
    const file = new StreamableFile(Buffer.from('pdf'));

    const result = await requestContextService.run(
      { correlationId: CORRELATION_ID, requestId: 'r-1' },
      async () =>
        await firstValueFrom(
          interceptor.intercept(contextWithStatus(200), { handle: () => of(file) }),
        ),
    );

    expect(result).toBe(file);
  });

  it('should report the status the handler set, when it overrode it to 503', async () => {
    const result = await requestContextService.run(
      { correlationId: CORRELATION_ID, requestId: 'r-1' },
      async () =>
        await firstValueFrom(
          interceptor.intercept(contextWithStatus(503), {
            handle: () => of({ status: 'degraded' }),
          }),
        ),
    );

    expect(result).toMatchObject({ status: 'SUCCESS', code: 503 });
  });

  it('should still produce a correlationId, when no request context is active', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(contextWithStatus(200), { handle: () => of({ ok: true }) }),
    );

    expect(
      (result as { meta: { tracing: { correlationId: string } } }).meta.tracing.correlationId,
    ).toEqual(expect.any(String));
  });
});
