import type { Request, Response } from 'express';

import { RequestContextService } from '../request-context.service';

import { RequestContextMiddleware } from './request-context.middleware';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('RequestContextMiddleware', () => {
  let middleware: RequestContextMiddleware;
  let requestContextService: RequestContextService;
  let response: { setHeader: ReturnType<typeof vi.fn> };
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    requestContextService = new RequestContextService();
    middleware = new RequestContextMiddleware(requestContextService);
    response = { setHeader: vi.fn() };
    next = vi.fn();
  });

  it('should generate a valid UUID v4 correlation id, when x-correlation-id is absent', () => {
    const request = { headers: {} } as unknown as Request;

    middleware.use(request, response as unknown as Response, next);

    expect(response.setHeader).toHaveBeenCalledWith(
      'x-correlation-id',
      expect.stringMatching(UUID_V4_PATTERN),
    );
  });

  it('should generate a valid UUID v4 request id, when x-request-id is absent', () => {
    const request = { headers: {} } as unknown as Request;

    middleware.use(request, response as unknown as Response, next);

    expect(response.setHeader).toHaveBeenCalledWith(
      'x-request-id',
      expect.stringMatching(UUID_V4_PATTERN),
    );
  });

  it('should reuse the incoming x-correlation-id header, when present', () => {
    const request = {
      headers: { 'x-correlation-id': '11111111-1111-4111-8111-111111111111' },
    } as unknown as Request;

    middleware.use(request, response as unknown as Response, next);

    expect(response.setHeader).toHaveBeenCalledWith(
      'x-correlation-id',
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('should reuse the incoming x-request-id header, when present', () => {
    const request = {
      headers: { 'x-request-id': '22222222-2222-4222-8222-222222222222' },
    } as unknown as Request;

    middleware.use(request, response as unknown as Response, next);

    expect(response.setHeader).toHaveBeenCalledWith(
      'x-request-id',
      '22222222-2222-4222-8222-222222222222',
    );
  });

  it('should set both response headers unconditionally', () => {
    const request = { headers: {} } as unknown as Request;

    middleware.use(request, response as unknown as Response, next);

    expect(response.setHeader).toHaveBeenCalledTimes(2);
  });

  it('should call next() inside the request context, making both ids readable via the service', () => {
    const request = {
      headers: {
        'x-correlation-id': '11111111-1111-4111-8111-111111111111',
        'x-request-id': '22222222-2222-4222-8222-222222222222',
      },
    } as unknown as Request;
    next = vi.fn(() => {
      expect(requestContextService.getCorrelationId()).toBe('11111111-1111-4111-8111-111111111111');
      expect(requestContextService.getRequestId()).toBe('22222222-2222-4222-8222-222222222222');
    });

    middleware.use(request, response as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
