import { HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { Request } from 'express';

import { ErrorCategory } from '../../errors/error-category.enum.js';
import { NotFoundError } from '../../errors/not-found/not-found-error.js';
import { type LoggerService } from '../../logger/logger.service.js';
import { RequestContextService } from '../../request-context/request-context.service.js';
import { type ErrorFormatService } from '../error-format.service.js';

import {
  GlobalExceptionFilter,
  REQUEST_REJECTED_LOG,
  UNHANDLED_ERROR_LOG,
} from './global-exception.filter.js';

const CORRELATION_ID = 'c-1';

class TestNotFoundError extends NotFoundError {
  public constructor(id: string) {
    super(`resource not found: "${id}"`, {
      code: 'TEST_NOT_FOUND',
      category: ErrorCategory.NOT_FOUND,
      params: { id },
    });
  }
}

interface ILoggedCall {
  level: 'warn' | 'error';
  fields: Record<string, unknown>;
  message: string;
  error?: unknown;
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let requestContextService: RequestContextService;
  let errorFormatService: { format: ReturnType<typeof vi.fn> };
  let loggerService: LoggerService;
  let logged: ILoggedCall[];
  let response: {
    setHeader: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
  let request: Request;
  let host: ArgumentsHost;

  beforeEach(() => {
    requestContextService = new RequestContextService();
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

    filter = new GlobalExceptionFilter(
      errorFormatService as unknown as ErrorFormatService,
      requestContextService,
      loggerService,
    );

    response = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    request = { method: 'POST', originalUrl: '/api/v1/imports', url: '/v1/example' } as Request;
    host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;
  });

  it('should leave response headers untouched, when it formats an error response', () => {
    requestContextService.run(
      {
        correlationId: CORRELATION_ID,
        requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        correlationIdSource: 'inbound',
      },
      () => {
        filter.catch(new Error('boom'), host);
      },
    );

    expect(response.setHeader).not.toHaveBeenCalled();
  });

  it('should return the error envelope with correlationId in meta.tracing, when the formatter returns an error', () => {
    requestContextService.run(
      {
        correlationId: CORRELATION_ID,
        requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        correlationIdSource: 'inbound',
      },
      () => {
        filter.catch(new Error('boom'), host);
      },
    );

    expect(response.json).toHaveBeenCalledWith({
      status: 'FAILED',
      code: HttpStatus.BAD_REQUEST,
      reason: 'BAD_REQUEST',
      message: 'invalid',
      meta: { tracing: { correlationId: CORRELATION_ID } },
    });
  });

  it('should fall back to a generated correlationId instead of throwing, when called outside of any request context', () => {
    expect(() => {
      filter.catch(new Error('boom'), host);
    }).not.toThrow();

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: { tracing: { correlationId: expect.any(String) as unknown as string } },
      }),
    );
  });

  it('should return a sanitized envelope, when the formatted error is a 500', () => {
    errorFormatService.format.mockReturnValue({
      statusCode: 500,
      error: { code: 'FATAL_BOOM', message: 'internal detail that must not leak' },
    });

    filter.catch(new Error('boom'), host);

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      }),
    );
  });

  it('should log a structured error line, when the status is 5xx', () => {
    errorFormatService.format.mockReturnValue({
      statusCode: 500,
      error: { code: 'FATAL_BOOM', message: 'internal detail that must not leak' },
    });

    filter.catch(new Error('boom'), host);

    expect(logged).toContainEqual({
      level: 'error',
      fields: expect.objectContaining({
        method: 'POST',
        url: '/api/v1/imports',
        statusCode: 500,
      }) as Record<string, unknown>,
      message: UNHANDLED_ERROR_LOG,
      error: expect.any(Error) as Error,
    });
  });

  it('should log a warning carrying the error code, when the status is 4xx', () => {
    errorFormatService.format.mockReturnValue({
      statusCode: HttpStatus.NOT_FOUND,
      error: { code: 'IMPORT_NOT_FOUND', message: 'Import run not found: "i-1"' },
    });

    filter.catch(new TestNotFoundError('i-1'), host);

    expect(logged.at(-1)).toMatchObject({
      level: 'warn',
      message: REQUEST_REJECTED_LOG,
      fields: { statusCode: HttpStatus.NOT_FOUND, errorCode: 'IMPORT_NOT_FOUND' },
    });
  });

  it('should log the fieldErrors, when the formatted error carries fieldErrors instead of details', () => {
    const fieldErrors = [{ field: 'dateHour', message: 'must match pattern' }];
    errorFormatService.format.mockReturnValue({
      statusCode: HttpStatus.BAD_REQUEST,
      error: { code: 'REQUEST_CONTRACT_VIOLATION', message: 'invalid request', fieldErrors },
    });

    filter.catch(new Error('boom'), host);

    expect(logged.at(-1)).toMatchObject({
      level: 'warn',
      message: REQUEST_REJECTED_LOG,
      fields: {
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: 'REQUEST_CONTRACT_VIOLATION',
        fieldErrors,
      },
    });
  });

  it('should not interpolate the correlation id into the message, when it formats an error response', () => {
    requestContextService.run(
      {
        correlationId: CORRELATION_ID,
        requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        correlationIdSource: 'inbound',
      },
      () => {
        filter.catch(new Error('boom'), host);
      },
    );

    expect(logged.at(-1)?.message).not.toContain(CORRELATION_ID);
  });
});
