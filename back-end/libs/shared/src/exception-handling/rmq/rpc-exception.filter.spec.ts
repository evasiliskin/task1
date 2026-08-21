import { HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { type RmqContext } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

import { type LoggerService } from '../../logger/logger.service.js';
import { type ErrorFormatService } from '../error-format.service.js';

import {
  RPC_REQUEST_REJECTED_LOG,
  RPC_UNHANDLED_ERROR_LOG,
  RpcAppExceptionFilter,
} from './rpc-exception.filter.js';

interface ILoggedCall {
  level: 'warn' | 'error';
  fields: Record<string, unknown>;
  message: string;
  error?: unknown;
}

describe('RpcAppExceptionFilter', () => {
  let filter: RpcAppExceptionFilter;
  let errorFormatService: { format: ReturnType<typeof vi.fn> };
  let loggerService: LoggerService;
  let logged: ILoggedCall[];

  const buildHost = (pattern: string | undefined): ArgumentsHost => {
    if (pattern === undefined) {
      return {
        switchToRpc: () => {
          throw new Error('no rpc context available');
        },
      } as unknown as ArgumentsHost;
    }

    const rmqContext = { getPattern: () => pattern } as unknown as RmqContext;

    return {
      switchToRpc: () => ({ getContext: <T>() => rmqContext as T }),
    } as unknown as ArgumentsHost;
  };

  beforeEach(() => {
    errorFormatService = {
      format: vi.fn().mockReturnValue({
        statusCode: HttpStatus.BAD_REQUEST,
        error: { code: 'BAD_REQUEST', message: 'invalid' },
      }),
    };

    logged = [];
    const stubLogger = {
      warn: (fields: Record<string, unknown>, message: string) => {
        logged.push({ level: 'warn', fields, message });
      },
      error: (fields: Record<string, unknown>, message: string, error?: unknown) => {
        logged.push({ level: 'error', fields, message, error });
      },
    };
    loggerService = {
      getLogger: vi.fn().mockReturnValue(stubLogger),
    } as unknown as LoggerService;

    filter = new RpcAppExceptionFilter(
      errorFormatService as unknown as ErrorFormatService,
      loggerService,
    );
  });

  it('should emit an rpc error carrying the formatted statusCode and error, when an exception is caught', async () => {
    const host = buildHost('import.upload');

    await expect(firstValueFrom(filter.catch(new Error('boom'), host))).rejects.toMatchObject({
      statusCode: HttpStatus.BAD_REQUEST,
      code: 'BAD_REQUEST',
      message: 'invalid',
    });
  });

  it('should log a structured error line, when the status is 5xx', async () => {
    errorFormatService.format.mockReturnValue({
      statusCode: 500,
      error: { code: 'FATAL_BOOM', message: 'internal detail' },
    });
    const host = buildHost('import.upload');
    const exception = new Error('boom');

    await firstValueFrom(filter.catch(exception, host)).catch(() => undefined);

    expect(logged).toContainEqual({
      level: 'error',
      fields: expect.objectContaining({
        pattern: 'import.upload',
        statusCode: 500,
        errorCode: 'FATAL_BOOM',
      }) as Record<string, unknown>,
      message: RPC_UNHANDLED_ERROR_LOG,
      error: exception,
    });
  });

  it('should log a warning carrying the error code, when the status is 4xx', async () => {
    const host = buildHost('import.upload');

    await firstValueFrom(filter.catch(new Error('boom'), host)).catch(() => undefined);

    expect(logged.at(-1)).toMatchObject({
      level: 'warn',
      message: RPC_REQUEST_REJECTED_LOG,
      fields: {
        pattern: 'import.upload',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: 'BAD_REQUEST',
      },
    });
  });

  it('should fall back to "unknown" instead of throwing, when no rpc context is available', async () => {
    const host = buildHost(undefined);

    await firstValueFrom(filter.catch(new Error('boom'), host)).catch(() => undefined);

    expect(logged.at(-1)).toMatchObject({
      fields: expect.objectContaining({ pattern: 'unknown' }) as Record<string, unknown>,
    });
  });
});
