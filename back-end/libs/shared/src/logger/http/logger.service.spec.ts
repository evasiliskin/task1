import { type PinoLogger } from 'nestjs-pino';

import { AppLogger } from '../app-logger';

import { LoggerService } from './logger.service';

describe('LoggerService', () => {
  it('should return an AppLogger bound to the given source and default "http" channel', () => {
    const pinoLogger = {} as PinoLogger;
    const service = new LoggerService(pinoLogger);

    const logger = service.getLogger('HealthController');

    expect(logger).toBeInstanceOf(AppLogger);
  });

  it('should bind the given channel, when explicitly provided', () => {
    const pinoLogger = { info: vi.fn() } as unknown as PinoLogger;
    const service = new LoggerService(pinoLogger);

    const logger = service.getLogger('Nest', 'bootstrap');
    logger.info({}, 'starting up');

    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(pinoLogger.info).toHaveBeenCalledWith(
      { source: 'Nest', channel: 'bootstrap' },
      'starting up',
    );
  });
});
