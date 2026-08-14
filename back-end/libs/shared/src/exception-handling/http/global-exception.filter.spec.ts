import { HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { Request } from 'express';

import { RequestContextService } from '../../request-context/request-context.service.js';
import { type ErrorFormatService } from '../error-format.service.js';

import { GlobalExceptionFilter } from './global-exception.filter.js';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let requestContextService: RequestContextService;
  let errorFormatService: { format: ReturnType<typeof vi.fn> };
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
    filter = new GlobalExceptionFilter(
      errorFormatService as unknown as ErrorFormatService,
      requestContextService,
    );

    response = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    request = { method: 'GET', url: '/v1/example' } as Request;
    host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;
  });

  it('should not touch response headers, relying on RequestContextMiddleware to have set them', () => {
    requestContextService.run({ correlationId: 'c-1', requestId: 'r-1' }, () => {
      filter.catch(new Error('boom'), host);
    });

    expect(response.setHeader).not.toHaveBeenCalled();
  });

  it('should return the error envelope with correlationId in meta.tracing, when the formatter returns an error', () => {
    requestContextService.run({ correlationId: 'c-1', requestId: 'r-1' }, () => {
      filter.catch(new Error('boom'), host);
    });

    expect(response.json).toHaveBeenCalledWith({
      status: 'FAILED',
      code: HttpStatus.BAD_REQUEST,
      reason: 'BAD_REQUEST',
      message: 'invalid',
      meta: { tracing: { correlationId: 'c-1' } },
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
});
