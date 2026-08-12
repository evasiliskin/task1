import { RequestContextService } from '../../request-context/request-context.service';
import { REDACT_CENSOR, REDACT_PATHS } from '../redact-paths';

import { pinoConfigFactory } from './pino-config.factory';

describe('pinoConfigFactory', () => {
  let requestContextService: RequestContextService;

  beforeEach(() => {
    requestContextService = new RequestContextService();
  });

  it('should set the level from config', () => {
    const params = pinoConfigFactory({ level: 'warn', transport: 'json' }, requestContextService);

    expect(params.pinoHttp).toMatchObject({ level: 'warn' });
  });

  it('should omit the transport option, when config.transport is "json"', () => {
    const params = pinoConfigFactory({ level: 'info', transport: 'json' }, requestContextService);

    expect(params.pinoHttp).toMatchObject({ transport: undefined });
  });

  it('should configure pino-pretty, when config.transport is "pretty"', () => {
    const params = pinoConfigFactory({ level: 'info', transport: 'pretty' }, requestContextService);

    expect(params.pinoHttp).toMatchObject({
      transport: { target: 'pino-pretty', options: { colorize: true, singleLine: true } },
    });
  });

  it('should mix in the active request context attributes into every log line', () => {
    const params = pinoConfigFactory({ level: 'info', transport: 'json' }, requestContextService);
    const mixin = (params.pinoHttp as { mixin: () => unknown }).mixin;

    const result = requestContextService.run({ correlationId: 'c-1', requestId: 'r-1' }, () =>
      mixin(),
    );

    expect(result).toEqual({ correlationId: 'c-1', requestId: 'r-1' });
  });

  it('should redact sensitive log paths using the shared REDACT_PATHS/REDACT_CENSOR', () => {
    const params = pinoConfigFactory({ level: 'info', transport: 'json' }, requestContextService);

    expect(params.pinoHttp).toMatchObject({
      redact: { paths: [...REDACT_PATHS], censor: REDACT_CENSOR },
    });
  });

  it('should ignore the two health-check routes from auto-logging', () => {
    const params = pinoConfigFactory({ level: 'info', transport: 'json' }, requestContextService);
    const ignore = (
      params.pinoHttp as { autoLogging: { ignore: (request: { url?: string }) => boolean } }
    ).autoLogging.ignore;

    expect(ignore({ url: '/health/service-a' })).toBe(true);
    expect(ignore({ url: '/health/service-b' })).toBe(true);
    expect(ignore({ url: '/v1/example' })).toBe(false);
  });
});
