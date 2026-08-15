import { Writable } from 'node:stream';

import { pino } from 'pino';

import { RequestContextService } from '../request-context/request-context.service.js';

import { buildBasePinoOptions } from './base-pino-options.js';

describe('buildBasePinoOptions', () => {
  it('should register the err serializer under the standard error key', () => {
    const options = buildBasePinoOptions(
      { level: 'info', transport: 'json', serviceName: 'svc' },
      new RequestContextService(),
    );

    expect(options.errorKey).toBe('err');
    expect(options.serializers?.err).toBeDefined();
  });

  it('should emit ISO-8601 timestamps', () => {
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

  it('should mix in the current request-context attributes onto every line', () => {
    const requestContextService = new RequestContextService();
    const options = buildBasePinoOptions(
      { level: 'info', transport: 'json', serviceName: 'svc' },
      requestContextService,
    );

    const attributes = requestContextService.run(
      { correlationId: 'c-1', requestId: 'r-1', correlationIdSource: 'inbound' },
      () => (options.mixin as () => Record<string, unknown>)(),
    );

    expect(attributes).toMatchObject({ correlationId: 'c-1', requestId: 'r-1' });
  });

  it('should emit the level as a label rather than a number', () => {
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

  it('should still stamp correlationId and requestId on a line logged with no extra fields', () => {
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
      { correlationId: 'c-2', requestId: 'r-2', correlationIdSource: 'inbound' },
      () => logger.info('message with no fields'),
    );

    expect(lines[0]).toMatchObject({ correlationId: 'c-2', requestId: 'r-2' });
  });

  it('should not leak per-line log fields into the live request-context store', () => {
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
      correlationId: 'c-3',
      requestId: 'r-3',
      correlationIdSource: 'inbound',
    } as const;

    const attributesAfterLogging = requestContextService.run(context, () => {
      logger.info({ statusCode: 500, extra: 'field' }, 'message with fields');

      return requestContextService.getAttributes();
    });

    expect(attributesAfterLogging).toEqual(context);
  });
});
