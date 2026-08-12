import { RequestContextService } from '../request-context/request-context.service';

import { pinoConfigFactory } from './pino-config.factory';
import { REDACT_CENSOR, REDACT_PATHS } from './redact-paths';

describe('pinoConfigFactory', () => {
  let requestContextService: RequestContextService;

  beforeEach(() => {
    requestContextService = new RequestContextService();
  });

  it('should set the level from config', () => {
    const options = pinoConfigFactory({ level: 'warn', transport: 'json' }, requestContextService);

    expect(options.level).toBe('warn');
  });

  it('should omit the transport option, when config.transport is "json"', () => {
    const options = pinoConfigFactory({ level: 'info', transport: 'json' }, requestContextService);

    expect(options.transport).toBeUndefined();
  });

  it('should configure pino-pretty, when config.transport is "pretty"', () => {
    const options = pinoConfigFactory(
      { level: 'info', transport: 'pretty' },
      requestContextService,
    );

    expect(options.transport).toEqual({
      target: 'pino-pretty',
      options: { colorize: true, singleLine: true },
    });
  });

  it('should mix in the active request context attributes into every log line', () => {
    const options = pinoConfigFactory({ level: 'info', transport: 'json' }, requestContextService);
    const mixin = options.mixin as () => unknown;

    const result = requestContextService.run({ correlationId: 'c-1', requestId: 'r-1' }, () =>
      mixin(),
    );

    expect(result).toEqual({ correlationId: 'c-1', requestId: 'r-1' });
  });

  it('should redact sensitive log paths using the shared REDACT_PATHS/REDACT_CENSOR', () => {
    const options = pinoConfigFactory({ level: 'info', transport: 'json' }, requestContextService);

    expect(options.redact).toEqual({ paths: [...REDACT_PATHS], censor: REDACT_CENSOR });
  });
});
