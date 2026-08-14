import { EventEmitter } from 'node:events';

import type { NextFunction, Request, Response } from 'express';
import type { Mock } from 'vitest';

import { RequestContextService } from '../../request-context/request-context.service.js';
import { type AppLogger } from '../app-logger.js';
import { REDACT_CENSOR } from '../redact-paths.js';

import {
  HttpLoggingMiddleware,
  REQUEST_COMPLETED_LOG,
  REQUEST_STARTED_LOG,
} from './http-logging.middleware.js';
import { type LoggerService } from './logger.service.js';

const CORRELATION_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const REQUEST_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

interface IFakeResponse extends EventEmitter {
  statusCode: number;
  getHeader: Mock<Response['getHeader']>;
}

const fixture = {
  request: (overrides: Partial<Request> = {}): Request =>
    ({
      method: 'GET',
      originalUrl: '/api/v1/events?limit=10',
      path: '/api/v1/events',
      query: { limit: '10' },
      body: {},
      headers: { 'user-agent': 'curl/8.7.1' },
      ip: '127.0.0.1',
      ...overrides,
    }) as unknown as Request,

  response: (statusCode = 200): IFakeResponse => {
    const response = new EventEmitter() as IFakeResponse;
    response.statusCode = statusCode;
    response.getHeader = vi.fn(() => 42);

    return response;
  },
};

describe('HttpLoggingMiddleware', () => {
  let logger: { info: Mock; warn: Mock; error: Mock };
  let loggerService: LoggerService;
  let requestContextService: RequestContextService;
  let middleware: HttpLoggingMiddleware;
  let next: Mock<NextFunction>;

  function handle(request: Request, response: IFakeResponse): void {
    requestContextService.run({ correlationId: CORRELATION_ID, requestId: REQUEST_ID }, () => {
      middleware.use(request, response as unknown as Response, next);
    });
  }

  function loggedMessages(): string[] {
    return [...logger.info.mock.calls, ...logger.warn.mock.calls, ...logger.error.mock.calls].map(
      ([, message]: [unknown, string]) => message,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();

    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    loggerService = {
      getLogger: vi.fn(() => logger as unknown as AppLogger),
    } as unknown as LoggerService;
    requestContextService = new RequestContextService();
    middleware = new HttpLoggingMiddleware(loggerService, requestContextService);
    next = vi.fn<NextFunction>();
  });

  describe('request start', () => {
    it('should log the whole request at info level, when the request enters the pipeline', () => {
      const request = fixture.request({
        method: 'POST',
        originalUrl: '/api/v1/imports?dryRun=false',
        path: '/api/v1/imports',
        query: { dryRun: 'false' },
        body: { dateHour: '2026-08-11-0' },
      });

      handle(request, fixture.response());

      expect(logger.info).toHaveBeenCalledWith(
        {
          correlationId: CORRELATION_ID,
          requestId: REQUEST_ID,
          request: {
            method: 'POST',
            url: '/api/v1/imports?dryRun=false',
            path: '/api/v1/imports',
            query: { dryRun: 'false' },
            body: { dateHour: '2026-08-11-0' },
            headers: { 'user-agent': 'curl/8.7.1' },
            ip: '127.0.0.1',
          },
        },
        REQUEST_STARTED_LOG,
      );
    });

    it('should censor the value, when a header or a body field is sensitive', () => {
      const request = fixture.request({
        headers: { authorization: 'Bearer gha-1', 'user-agent': 'curl/8.7.1' },
        body: { name: 'ok', password: 'hunter2' },
      });

      handle(request, fixture.response());

      const [fields] = logger.info.mock.calls[0] as [{ request: Record<string, unknown> }];

      expect(fields.request).toMatchObject({
        headers: { authorization: REDACT_CENSOR, 'user-agent': 'curl/8.7.1' },
        body: { name: 'ok', password: REDACT_CENSOR },
      });
    });

    it('should log an empty body, when the request carries no payload', () => {
      handle(fixture.request(), fixture.response());

      const [fields] = logger.info.mock.calls[0] as [
        { request: { body: unknown; query: unknown } },
      ];

      expect(fields.request.body).toEqual({});
    });

    it('should pass the request on, when it has been logged', () => {
      handle(fixture.request(), fixture.response());

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('request completion', () => {
    it('should log the outcome at info level, when the status is below 400', () => {
      const response = fixture.response(202);

      handle(fixture.request(), response);
      response.emit('finish');

      expect(logger.info).toHaveBeenLastCalledWith(
        {
          correlationId: CORRELATION_ID,
          requestId: REQUEST_ID,
          method: 'GET',
          url: '/api/v1/events?limit=10',
          statusCode: 202,
          contentLength: 42,
          durationMs: expect.any(Number) as number,
        },
        REQUEST_COMPLETED_LOG,
      );
    });

    it('should log the outcome at warn level, when the status is 4xx', () => {
      const response = fixture.response(404);

      handle(fixture.request(), response);
      response.emit('finish');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 404 }),
        REQUEST_COMPLETED_LOG,
      );
    });

    it('should log the outcome at error level, when the status is 5xx', () => {
      const response = fixture.response(503);

      handle(fixture.request(), response);
      response.emit('finish');

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 503 }),
        REQUEST_COMPLETED_LOG,
      );
    });

    it('should log the outcome once, when both finish and close fire', () => {
      const response = fixture.response();

      handle(fixture.request(), response);
      response.emit('finish');
      response.emit('close');

      expect(loggedMessages()).toEqual([REQUEST_STARTED_LOG, REQUEST_COMPLETED_LOG]);
    });

    it('should log the outcome, when the client aborts and only close fires', () => {
      const response = fixture.response();

      handle(fixture.request(), response);
      response.emit('close');

      expect(logger.info).toHaveBeenLastCalledWith(
        expect.objectContaining({ statusCode: 200 }),
        REQUEST_COMPLETED_LOG,
      );
    });

    it('should keep both tracing ids, when the async context is no longer active', () => {
      const response = fixture.response();

      handle(fixture.request(), response);

      // Outside requestContextService.run(): pino's mixin contributes nothing here.
      expect(requestContextService.getCorrelationId()).toBeUndefined();

      response.emit('finish');

      expect(logger.info).toHaveBeenLastCalledWith(
        expect.objectContaining({ correlationId: CORRELATION_ID, requestId: REQUEST_ID }),
        REQUEST_COMPLETED_LOG,
      );
    });
  });

  describe('excluded paths', () => {
    it('should log nothing, when the request targets the aggregated health endpoint', () => {
      const request = fixture.request({ path: '/api/v1/health', originalUrl: '/api/v1/health' });
      const response = fixture.response();

      handle(request, response);
      response.emit('finish');

      expect(loggedMessages()).toEqual([]);
    });

    it('should log nothing, when the request targets a nested health probe', () => {
      const request = fixture.request({ path: '/api/v1/health/ready' });
      const response = fixture.response();

      handle(request, response);
      response.emit('finish');

      expect(loggedMessages()).toEqual([]);
    });

    it('should log nothing, when the request targets the Swagger UI', () => {
      const request = fixture.request({ path: '/api-docs', originalUrl: '/api-docs' });
      const response = fixture.response();

      handle(request, response);
      response.emit('finish');

      expect(loggedMessages()).toEqual([]);
    });

    it('should log nothing, when the request targets a Swagger UI asset', () => {
      const request = fixture.request({ path: '/api-docs/swagger-ui-bundle.js' });
      const response = fixture.response();

      handle(request, response);
      response.emit('finish');

      expect(loggedMessages()).toEqual([]);
    });

    it('should pass the request on, when the path is excluded from logging', () => {
      handle(fixture.request({ path: '/api/v1/health' }), fixture.response());

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should log the request, when a path segment merely starts with "health"', () => {
      handle(fixture.request({ path: '/api/v1/health-report' }), fixture.response());

      expect(loggedMessages()).toEqual([REQUEST_STARTED_LOG]);
    });
  });
});
