import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';

import { RequestContextService } from '../../request-context/request-context.service.js';
import { type LoggerService } from '../logger.service.js';

import {
  BROKEN_TRACE_LOG,
  MESSAGE_FAILED_LOG,
  MESSAGE_HANDLED_LOG,
  MESSAGE_RECEIVED_LOG,
  RmqLoggingInterceptor,
} from './rmq-logging.interceptor.js';

describe('RmqLoggingInterceptor', () => {
  let logged: { level: string; fields: Record<string, unknown>; message: string }[];
  let requestContextService: RequestContextService;
  let interceptor: RmqLoggingInterceptor;

  function capture(level: string) {
    return (fields: Record<string, unknown>, message: string) => {
      logged.push({ level, fields, message });
    };
  }

  const executionContext = {
    switchToRpc: () => ({ getContext: () => ({ getPattern: () => 'archive.import.download' }) }),
  } as unknown as ExecutionContext;

  beforeEach(() => {
    logged = [];
    requestContextService = new RequestContextService();
    const loggerService = {
      getLogger: () => ({
        info: capture('info'),
        warn: capture('warn'),
        error: capture('error'),
      }),
    } as unknown as LoggerService;

    interceptor = new RmqLoggingInterceptor(loggerService, requestContextService);
  });

  function runWith<T>(source: 'inbound' | 'generated', handler: CallHandler): Promise<T> {
    return requestContextService.run(
      { correlationId: 'c-1', requestId: 'r-1', correlationIdSource: source },
      () => firstValueFrom(interceptor.intercept(executionContext, handler)) as Promise<T>,
    );
  }

  it('should log receipt and completion with a duration, when the handler succeeds', async () => {
    await runWith('inbound', { handle: () => of('ok') });

    expect(logged.map((entry) => entry.message)).toEqual([
      MESSAGE_RECEIVED_LOG,
      MESSAGE_HANDLED_LOG,
    ]);
    expect(logged[1].fields).toMatchObject({ pattern: 'archive.import.download' });
    expect(logged[1].fields.durationMs).toEqual(expect.any(Number));
  });

  it('should log a failure, when the handler errors', async () => {
    await expect(
      runWith('inbound', { handle: () => throwError(() => new Error('boom')) }),
    ).rejects.toThrow('boom');

    expect(logged.at(-1)?.message).toBe(MESSAGE_FAILED_LOG);
    expect(logged.at(-1)?.level).toBe('error');
  });

  it('should warn about a broken trace chain, when the correlation id was generated locally', async () => {
    await runWith('generated', { handle: () => of('ok') });

    expect(logged.map((entry) => entry.message)).toContain(BROKEN_TRACE_LOG);
  });
});
