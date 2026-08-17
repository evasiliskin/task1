import { pino, type Logger } from 'pino';

import { AppLogger } from './app-logger.js';
import { LoggerService } from './logger.service.js';

describe('LoggerService', () => {
  let pinoLogger: Logger;

  beforeEach(() => {
    pinoLogger = pino({ enabled: false });
  });

  it('should return an AppLogger bound to the injected default channel, when no channel is given', () => {
    const service = new LoggerService(pinoLogger, 'rmq');

    expect(service.getLogger('HealthController')).toBeInstanceOf(AppLogger);
  });

  it('should honour an explicitly supplied channel, when one is given', () => {
    const service = new LoggerService(pinoLogger, 'http');
    const child = vi.spyOn(pinoLogger, 'child');

    service.getLogger('Nest', 'bootstrap');

    expect(child).toHaveBeenCalledWith({ source: 'Nest', channel: 'bootstrap' });
  });
});
