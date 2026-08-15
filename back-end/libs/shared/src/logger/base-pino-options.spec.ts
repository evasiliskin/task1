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
});
