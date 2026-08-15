import { EventEmitter } from 'node:events';

import type { NextFunction, Request, Response } from 'express';
import type { Mock } from 'vitest';

import { RequestContextService } from '../../request-context/request-context.service.js';
import { type AppLogger } from '../app-logger.js';
import { type LoggerService } from '../logger.service.js';

import {
  HttpLoggingMiddleware,
  isUnloggedPath,
  REQUEST_COMPLETED_LOG,
  REQUEST_DETAIL_LOG,
  REQUEST_STARTED_LOG,
} from './http-logging.middleware.js';

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

describe('isUnloggedPath', () => {
  it('should skip logging, when the path is a health probe', () => {
    expect(isUnloggedPath('/health/ready')).toBe(true);
  });

  it('should not skip logging, when "health" is a nested resource segment', () => {
    expect(isUnloggedPath('/api/v1/imports/health')).toBe(false);
  });
});

describe('HttpLoggingMiddleware', () => {
  let logger: { info: Mock; debug: Mock; warn: Mock; error: Mock; isLevelEnabled: Mock };
  let loggerService: LoggerService;
  let requestContextService: RequestContextService;
  let middleware: HttpLoggingMiddleware;
  let next: Mock<NextFunction>;
  let messages: string[];

  function handle(request: Request, response: IFakeResponse): void {
    requestContextService.run(
      { correlationId: CORRELATION_ID, requestId: REQUEST_ID, correlationIdSource: 'inbound' },
      () => {
        middleware.use(request, response as unknown as Response, next);
      },
    );
  }

  function loggedMessages(): string[] {
    return messages;
  }

  function setUp(debugEnabled: boolean): void {
    messages = [];

    const record = (): Mock =>
      vi.fn((...args: unknown[]) => {
        messages.push(args[1] as string);
      });

    logger = {
      info: record(),
      debug: record(),
      warn: record(),
      error: record(),
      isLevelEnabled: vi.fn(() => debugEnabled),
    };
    loggerService = {
      getLogger: vi.fn(() => logger as unknown as AppLogger),
    } as unknown as LoggerService;
    requestContextService = new RequestContextService();
    middleware = new HttpLoggingMiddleware(loggerService, requestContextService);
    next = vi.fn<NextFunction>();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setUp(true);
  });

  describe('request start', () => {
    it('should log method, url, path, ip and user-agent at info level, when the request enters the pipeline', () => {
      const request = fixture.request({
        method: 'POST',
        originalUrl: '/api/v1/imports?dryRun=false',
        path: '/api/v1/imports',
        headers: { 'user-agent': 'curl/8.7.1' },
      });

      handle(request, fixture.response());

      expect(logger.info).toHaveBeenCalledWith(
        {
          correlationId: CORRELATION_ID,
          requestId: REQUEST_ID,
          correlationIdSource: 'inbound',
          request: {
            method: 'POST',
            url: '/api/v1/imports?dryRun=false',
            path: '/api/v1/imports',
            ip: '127.0.0.1',
            userAgent: 'curl/8.7.1',
          },
        },
        REQUEST_STARTED_LOG,
      );
    });

    it('should not include the request body or headers in the start line, when the request enters the pipeline', () => {
      const request = fixture.request({ body: { name: 'ok', password: 'hunter2' } });

      handle(request, fixture.response());

      const [fields] = logger.info.mock.calls[0] as [{ request: Record<string, unknown> }];

      expect(fields.request).not.toHaveProperty('body');
      expect(fields.request).not.toHaveProperty('headers');
    });

    it('should pass the request on, when it has been logged', () => {
      handle(fixture.request(), fixture.response());

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('request detail', () => {
    it('should log the parsed body, query and allowlisted headers at debug level, when debug is enabled', () => {
      const request = fixture.request({
        method: 'POST',
        originalUrl: '/api/v1/imports?dryRun=false',
        query: { dryRun: 'false' },
        body: { dateHour: '2026-08-11-0' },
        headers: { 'user-agent': 'curl/8.7.1', authorization: 'Bearer gha-1' },
      });

      handle(request, fixture.response());

      expect(logger.debug).toHaveBeenCalledWith(
        {
          correlationId: CORRELATION_ID,
          requestId: REQUEST_ID,
          correlationIdSource: 'inbound',
          request: {
            method: 'POST',
            url: '/api/v1/imports?dryRun=false',
            query: { dryRun: 'false' },
            body: { dateHour: '2026-08-11-0' },
            headers: { 'user-agent': 'curl/8.7.1' },
          },
        },
        REQUEST_DETAIL_LOG,
      );
    });

    it('should omit a header entirely, when it is not on the allowlist', () => {
      const request = fixture.request({
        headers: { authorization: 'Bearer gha-1', 'user-agent': 'curl/8.7.1' },
      });

      handle(request, fixture.response());

      const [fields] = logger.debug.mock.calls[0] as [{ request: { headers: unknown } }];

      expect(fields.request.headers).not.toHaveProperty('authorization');
    });

    it('should truncate an oversized body, when it exceeds the byte cap', () => {
      const request = fixture.request({ body: { blob: 'x'.repeat(5000) } });

      handle(request, fixture.response());

      const [fields] = logger.debug.mock.calls[0] as [{ request: { body: unknown } }];

      expect(fields.request.body).toEqual({
        truncated: true,
        approximateBytes: expect.any(Number) as number,
      });
    });

    it('should not log the detail line, when debug is disabled', () => {
      setUp(false);

      handle(fixture.request(), fixture.response());

      expect(logger.debug).not.toHaveBeenCalled();
    });

    it('should not build the detail payload, when debug is disabled', () => {
      setUp(false);

      handle(fixture.request({ body: { blob: 'x'.repeat(5000) } }), fixture.response());

      expect(logger.isLevelEnabled).toHaveBeenCalledWith('debug');
      expect(logger.debug).not.toHaveBeenCalled();
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
          correlationIdSource: 'inbound',
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

      expect(loggedMessages()).toEqual([
        REQUEST_STARTED_LOG,
        REQUEST_DETAIL_LOG,
        REQUEST_COMPLETED_LOG,
      ]);
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
      const request = fixture.request({
        path: '/api/v1/health/live',
        originalUrl: '/api/v1/health/live',
      });
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
      handle(fixture.request({ path: '/health' }), fixture.response());

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should log the request, when a path segment merely starts with "health"', () => {
      handle(
        fixture.request({ path: '/health-report', originalUrl: '/health-report' }),
        fixture.response(),
      );

      expect(loggedMessages()).toEqual([REQUEST_STARTED_LOG, REQUEST_DETAIL_LOG]);
    });

    it('should log the request, when "health" is a nested resource segment', () => {
      const request = fixture.request({
        path: '/api/v1/imports/health',
        originalUrl: '/api/v1/imports/health',
      });

      handle(request, fixture.response());

      expect(loggedMessages()).toEqual([REQUEST_STARTED_LOG, REQUEST_DETAIL_LOG]);
    });
  });
});
