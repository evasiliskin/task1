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
    const params = pinoConfigFactory({ ...CONFIG, level: 'warn' }, requestContextService);

    expect(params.pinoHttp).toMatchObject({ level: 'warn' });
  });

  it('should omit the transport option, when config.transport is "json"', () => {
    const params = pinoConfigFactory(CONFIG, requestContextService);

    expect(params.pinoHttp).toMatchObject({ transport: undefined });
  });

  it('should configure pino-pretty, when config.transport is "pretty"', () => {
    const params = pinoConfigFactory({ ...CONFIG, transport: 'pretty' }, requestContextService);

    expect(params.pinoHttp).toMatchObject({
      transport: { target: 'pino-pretty', options: { colorize: true, singleLine: true } },
    });
  });

  it('should mix in the active request context attributes into every log line', () => {
    const params = pinoConfigFactory(CONFIG, requestContextService);
    const mixin = (params.pinoHttp as { mixin: () => unknown }).mixin;

    const result = requestContextService.run({ correlationId: 'c-1', requestId: 'r-1' }, () =>
      mixin(),
    );

    expect(result).toEqual({ correlationId: 'c-1', requestId: 'r-1' });
  });

  it('should redact sensitive log paths using the shared REDACT_PATHS/REDACT_CENSOR', () => {
    const params = pinoConfigFactory(CONFIG, requestContextService);

    expect(params.pinoHttp).toMatchObject({
      redact: { paths: [...REDACT_PATHS], censor: REDACT_CENSOR },
    });
  });

  it('should stamp the service name on every log line, when the config is built', () => {
    const params = pinoConfigFactory(CONFIG, requestContextService);

    expect(params.pinoHttp).toMatchObject({ base: { service: 'api-gateway' } });
  });

  it('should disable pino-http auto-logging, when the config is built', () => {
    const params = pinoConfigFactory(CONFIG, requestContextService);

    expect(params.pinoHttp).toMatchObject({ autoLogging: false });
  });

  it('should mount the nestjs-pino middleware on no routes, when the config is built', () => {
    const params = pinoConfigFactory(CONFIG, requestContextService);

    expect(params.forRoutes).toEqual([]);
  });
});
