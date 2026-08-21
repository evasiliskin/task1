import type { Request, Response } from 'express';

import { RequestContextService } from '../request-context.service.js';

import { buildRequestContextExpressMiddleware } from './request-context.express-middleware.js';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('buildRequestContextExpressMiddleware', () => {
  let requestContextService: RequestContextService;
  let middleware: (request: Request, response: Response, next: () => void) => void;
  let response: { setHeader: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    requestContextService = new RequestContextService();
    middleware = buildRequestContextExpressMiddleware(requestContextService);
    response = { setHeader: vi.fn() };
  });

  it('should generate a valid UUID v4 correlation id and set it on the response, when x-correlation-id is absent', () => {
    const request = { headers: {} } as unknown as Request;

    middleware(request, response as unknown as Response, () => undefined);

    expect(response.setHeader).toHaveBeenCalledWith(
      'x-correlation-id',
      expect.stringMatching(UUID_V4_PATTERN),
    );
  });

  it('should reuse the incoming x-correlation-id header, when present', () => {
    const request = {
      headers: { 'x-correlation-id': '11111111-1111-4111-8111-111111111111' },
    } as unknown as Request;

    middleware(request, response as unknown as Response, () => undefined);

    expect(response.setHeader).toHaveBeenCalledWith(
      'x-correlation-id',
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('should expose the correlation id via the service, when next() runs', () => {
    const request = { headers: {} } as unknown as Request;
    let nextWasCalled = false;

    middleware(request, response as unknown as Response, () => {
      nextWasCalled = true;
      expect(requestContextService.getCorrelationId()).toBeDefined();
    });

    expect(nextWasCalled).toBe(true);
  });

  it('should not mint a second context, when one is already established', () => {
    const request = { headers: {} } as unknown as Request;
    const seen: (string | undefined)[] = [];

    middleware(request, response as unknown as Response, () => {
      seen.push(requestContextService.getCorrelationId());

      middleware(request, response as unknown as Response, () => {
        seen.push(requestContextService.getCorrelationId());
      });
    });

    expect(seen[0]).toBeDefined();
    expect(seen[1]).toBe(seen[0]);
  });

  it('should not call setHeader again on re-entry, when a context is already established', () => {
    const request = { headers: {} } as unknown as Request;

    middleware(request, response as unknown as Response, () => {
      response.setHeader.mockClear();

      middleware(request, response as unknown as Response, () => undefined);

      expect(response.setHeader).not.toHaveBeenCalled();
    });
  });
});
