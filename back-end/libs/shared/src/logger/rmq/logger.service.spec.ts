import { type Logger } from 'pino';

import { AppLogger } from '../app-logger.js';

import { LoggerService } from './logger.service.js';

describe('LoggerService', () => {
  it('should return an AppLogger bound to the given source and default "rmq" channel', () => {
    const pinoLogger = {} as Logger;
    const service = new LoggerService(pinoLogger);

    const logger = service.getLogger('HealthController');

    expect(logger).toBeInstanceOf(AppLogger);
  });

  it('should bind the given channel, when explicitly provided', () => {
    const pinoLogger = { info: vi.fn() } as unknown as Logger;
    const service = new LoggerService(pinoLogger);

    const logger = service.getLogger('Nest', 'bootstrap');
    logger.info({}, 'starting up');

    expect(pinoLogger.info).toHaveBeenCalledWith(
      { source: 'Nest', channel: 'bootstrap' },
      'starting up',
    );
  });
});
