import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { firstValueFrom, lastValueFrom, of, throwError } from 'rxjs';

import { RPC_PATTERNS } from '../../messaging/rpc-patterns.const.js';
import { RequestContextService } from '../../request-context/request-context.service.js';
import { type LoggerService } from '../logger.service.js';

import {
  BROKEN_TRACE_LOG,
  MESSAGE_DETAIL_LOG,
  MESSAGE_FAILED_LOG,
  MESSAGE_HANDLED_LOG,
  MESSAGE_RECEIVED_LOG,
  RmqLoggingInterceptor,
} from './rmq-logging.interceptor.js';

type LoggedLine = Record<string, unknown> & { msg: string; level: MockedLevel };
type LogLevel = 'trace' | 'debug' | 'info';
type MockedLevel = 'info' | 'warn' | 'error' | 'debug';

// Lower rank == more verbose, matching pino's own ordering. isLevelEnabled(check) is true when
// the configured level is at least as verbose as the level being checked.
const LEVEL_RANK: Record<LogLevel, number> = { trace: 10, debug: 20, info: 30 };

function buildExecutionContext(pattern: string, payload: unknown = {}): ExecutionContext {
  return {
    switchToRpc: () => ({
      getContext: () => ({ getPattern: () => pattern }),
      getData: () => payload,
    }),
  } as unknown as ExecutionContext;
}

describe('RmqLoggingInterceptor', () => {
  let requestContextService: RequestContextService;

  function buildInterceptor(options: { level?: LogLevel } = {}): {
    interceptor: RmqLoggingInterceptor;
    lines: LoggedLine[];
  } {
    const level = options.level ?? 'info';
    const lines: LoggedLine[] = [];

    function capture(level: MockedLevel) {
      return (fields: Record<string, unknown>, message: string): void => {
        lines.push({ ...fields, msg: message, level });
      };
    }

    const loggerService = {
      getLogger: () => ({
        info: capture('info'),
        warn: capture('warn'),
        error: capture('error'),
        debug: capture('debug'),
        isLevelEnabled: (checkLevel: string) =>
          // eslint-disable-next-line security/detect-object-injection -- checkLevel is test-authored, constrained to LogLevel, not external input.
          LEVEL_RANK[level] <= (LEVEL_RANK[checkLevel as LogLevel] ?? LEVEL_RANK.info),
      }),
    } as unknown as LoggerService;

    requestContextService = new RequestContextService();

    return { interceptor: new RmqLoggingInterceptor(loggerService, requestContextService), lines };
  }

  function runWith<T>(
    interceptor: RmqLoggingInterceptor,
    source: 'inbound' | 'generated',
    handler: CallHandler,
  ): Promise<T> {
    return requestContextService.run(
      { correlationId: 'c-1', requestId: 'r-1', correlationIdSource: source },
      () =>
        firstValueFrom(
          interceptor.intercept(buildExecutionContext('archive.import.download'), handler),
        ) as Promise<T>,
    );
  }

  it('should log receipt and completion with a duration, when the handler succeeds', async () => {
    const { interceptor, lines } = buildInterceptor();

    await runWith(interceptor, 'inbound', { handle: () => of('ok') });

    expect(lines.map((entry) => entry.msg)).toEqual([MESSAGE_RECEIVED_LOG, MESSAGE_HANDLED_LOG]);
    expect(lines[1]).toMatchObject({ pattern: 'archive.import.download' });
    expect(lines[1].durationMs).toEqual(expect.any(Number));
  });

  it('should log a failure, when the handler errors', async () => {
    const { interceptor, lines } = buildInterceptor();

    await expect(
      runWith(interceptor, 'inbound', { handle: () => throwError(() => new Error('boom')) }),
    ).rejects.toThrow('boom');

    expect(lines.at(-1)?.msg).toBe(MESSAGE_FAILED_LOG);
    expect(lines.at(-1)?.level).toBe('error');
  });

  it('should warn about a broken trace chain, when the correlation id was generated locally', async () => {
    const { interceptor, lines } = buildInterceptor();

    await runWith(interceptor, 'generated', { handle: () => of('ok') });

    expect(lines).toContainEqual(expect.objectContaining({ msg: BROKEN_TRACE_LOG, level: 'warn' }));
  });

  it('should log the payload at debug, when debug is enabled', async () => {
    const { interceptor, lines } = buildInterceptor({ level: 'debug' });

    await lastValueFrom(
      interceptor.intercept(
        buildExecutionContext('archive.import.download', {
          importId: 'i-1',
          dateHour: '2024-01-01-0',
        }),
        { handle: () => of('ok') },
      ),
    );

    expect(lines).toContainEqual(
      expect.objectContaining({
        msg: MESSAGE_DETAIL_LOG,
        level: 'debug',
        payload: { importId: 'i-1', dateHour: '2024-01-01-0' },
      }),
    );
  });

  it('should not log health pings at all', async () => {
    const { interceptor, lines } = buildInterceptor({ level: 'trace' });

    await lastValueFrom(
      interceptor.intercept(buildExecutionContext(RPC_PATTERNS.HEALTH_CHECK, {}), {
        handle: () => of('ok'),
      }),
    );

    expect(lines).toHaveLength(0);
  });
});
