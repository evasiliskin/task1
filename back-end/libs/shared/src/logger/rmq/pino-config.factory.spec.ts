import { type ILoggerConfiguration } from '../../config/logger.config.js';
import { RequestContextService } from '../../request-context/request-context.service.js';
import { REDACT_CENSOR, REDACT_PATHS } from '../redact-paths.js';

import { pinoConfigFactory } from './pino-config.factory.js';

const CONFIG = {
  level: 'info',
  transport: 'json',
  serviceName: 'api-gateway',
} as const satisfies ILoggerConfiguration;

describe('pinoConfigFactory', () => {
  let requestContextService: RequestContextService;

  beforeEach(() => {
    requestContextService = new RequestContextService();
  });

  it('should set the level from config', () => {
    const options = pinoConfigFactory({ ...CONFIG, level: 'warn' }, requestContextService);

    expect(options.level).toBe('warn');
  });

  it('should omit the transport option, when config.transport is "json"', () => {
    const options = pinoConfigFactory(CONFIG, requestContextService);

    expect(options.transport).toBeUndefined();
  });

  it('should configure pino-pretty, when config.transport is "pretty"', () => {
    const options = pinoConfigFactory({ ...CONFIG, transport: 'pretty' }, requestContextService);

    expect(options.transport).toEqual({
      target: 'pino-pretty',
      options: { colorize: true, singleLine: true },
    });
  });

  it('should mix in the active request context attributes into every log line', () => {
    const options = pinoConfigFactory(CONFIG, requestContextService);
    const mixin = options.mixin as () => unknown;

    const result = requestContextService.run({ correlationId: 'c-1', requestId: 'r-1' }, () =>
      mixin(),
    );

    expect(result).toEqual({ correlationId: 'c-1', requestId: 'r-1' });
  });

  it('should stamp the service name on every log line, when the config is built', () => {
    const options = pinoConfigFactory(CONFIG, requestContextService);

    expect(options.base).toMatchObject({ service: 'api-gateway' });
  });

  it('should keep pid and hostname alongside the service name, when the config is built', () => {
    const options = pinoConfigFactory(CONFIG, requestContextService);

    expect(options.base).toEqual({
      pid: process.pid,
      hostname: expect.any(String) as string,
      service: 'api-gateway',
    });
  });

  it('should redact sensitive log paths using the shared REDACT_PATHS/REDACT_CENSOR', () => {
    const options = pinoConfigFactory(CONFIG, requestContextService);

    expect(options.redact).toEqual({ paths: [...REDACT_PATHS], censor: REDACT_CENSOR });
  });
});
