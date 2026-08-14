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

  it('should include correlationId and requestId in the JSON error body', () => {
    requestContextService.run({ correlationId: 'c-1', requestId: 'r-1' }, () => {
      filter.catch(new Error('boom'), host);
    });

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: 'c-1', requestId: 'r-1' }),
    );
  });

  it('should fall back to generated ids instead of throwing, when called outside of any request context', () => {
    expect(() => {
      filter.catch(new Error('boom'), host);
    }).not.toThrow();

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        correlationId: expect.any(String),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        requestId: expect.any(String),
      }),
    );
  });
});
