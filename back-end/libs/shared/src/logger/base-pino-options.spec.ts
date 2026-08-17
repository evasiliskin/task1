import { Writable } from 'node:stream';

import { pino } from 'pino';

import { RequestContextService } from '../request-context/request-context.service.js';

import { buildBasePinoOptions } from './base-pino-options.js';

describe('buildBasePinoOptions', () => {
  it('should register the err serializer under the standard error key, when options are built', () => {
    const options = buildBasePinoOptions(
      { level: 'info', transport: 'json', serviceName: 'svc' },
      new RequestContextService(),
    );

    expect(options.errorKey).toBe('err');
    expect(options.serializers?.err).toBeDefined();
  });

  it('should emit ISO-8601 timestamps, when a line is logged', () => {
    const options = buildBasePinoOptions(
      { level: 'info', transport: 'json', serviceName: 'svc' },
      new RequestContextService(),
    );

    expect(options.timestamp).toBe(pino.stdTimeFunctions.isoTime);
  });

  it('should leave transport undefined, when the configured transport is json', () => {
    const options = buildBasePinoOptions(
      { level: 'info', transport: 'json', serviceName: 'svc' },
      new RequestContextService(),
    );

    expect(options.transport).toBeUndefined();
  });

  it('should configure pino-pretty, when the configured transport is pretty', () => {
    const options = buildBasePinoOptions(
      { level: 'info', transport: 'pretty', serviceName: 'svc' },
      new RequestContextService(),
    );

    expect(options.transport).toEqual({
      target: 'pino-pretty',
      options: { colorize: true, singleLine: true },
    });
  });

  it('should mix in the current request-context attributes, when a line is logged', () => {
    const requestContextService = new RequestContextService();
    const options = buildBasePinoOptions(
      { level: 'info', transport: 'json', serviceName: 'svc' },
      requestContextService,
    );

    const attributes = requestContextService.run(
      {
        correlationId: '8f14e45f-ceea-4e0a-9d1b-3a2e6f7c8b90',
        requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        correlationIdSource: 'inbound',
      },
      () => (options.mixin as () => Record<string, unknown>)(),
    );

    expect(attributes).toMatchObject({
      correlationId: '8f14e45f-ceea-4e0a-9d1b-3a2e6f7c8b90',
      requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    });
  });

  it('should emit the level as a label rather than a number, when a line is logged', () => {
    const lines: Record<string, unknown>[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
        callback();
      },
    });
    const options = buildBasePinoOptions(
      { level: 'info', transport: 'json', serviceName: 'api-gateway' },
      new RequestContextService(),
    );

    pino(options, stream).error({ statusCode: 500 }, 'unhandled error');

    expect(lines[0]).toMatchObject({ level: 'error' });
  });

  it('should still stamp correlationId and requestId, when a line is logged with no extra fields', () => {
    const lines: Record<string, unknown>[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
        callback();
      },
    });
    const requestContextService = new RequestContextService();
    const options = buildBasePinoOptions(
      { level: 'info', transport: 'json', serviceName: 'svc' },
      requestContextService,
    );
    const logger = pino(options, stream);

    requestContextService.run(
      {
        correlationId: '2b6d8a17-4c39-4f52-b8e1-7d40a9c35f26',
        requestId: 'a3d81b60-9f27-4e85-b104-2c6f5d90e731',
        correlationIdSource: 'inbound',
      },
      () => logger.info('message with no fields'),
    );

    expect(lines[0]).toMatchObject({
      correlationId: '2b6d8a17-4c39-4f52-b8e1-7d40a9c35f26',
      requestId: 'a3d81b60-9f27-4e85-b104-2c6f5d90e731',
    });
  });

  it('should not leak per-line log fields into the request-context store, when a line is logged', () => {
    const stream = new Writable({
      write(_chunk: Buffer, _encoding, callback) {
        callback();
      },
    });
    const requestContextService = new RequestContextService();
    const options = buildBasePinoOptions(
      { level: 'info', transport: 'json', serviceName: 'svc' },
      requestContextService,
    );
    const logger = pino(options, stream);
    const context = {
      correlationId: 'd91f7e30-5a68-4b74-9c02-6ef8b1d45a37',
      requestId: '6e40c25a-8b13-4d97-a2f6-5b09e3c184d2',
      correlationIdSource: 'inbound',
    } as const;

    const attributesAfterLogging = requestContextService.run(context, () => {
      logger.info({ statusCode: 500, extra: 'field' }, 'message with fields');

      return requestContextService.getAttributes();
    });

    expect(attributesAfterLogging).toEqual(context);
  });
});
