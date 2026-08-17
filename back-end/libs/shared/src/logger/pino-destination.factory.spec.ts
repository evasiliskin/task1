import { createPinoDestination } from './pino-destination.factory.js';

describe('createPinoDestination', () => {
  it('should return a buffered async destination, when the transport is json', () => {
    const destination = createPinoDestination({
      level: 'info',
      transport: 'json',
      serviceName: 'api-gateway',
    });

    expect(destination).toBeDefined();
    expect(typeof destination?.flushSync).toBe('function');
  });

  it('should configure a bounded periodic flush interval, when the transport is json', () => {
    const destination = createPinoDestination({
      level: 'info',
      transport: 'json',
      serviceName: 'api-gateway',
    }) as unknown as { _periodicFlush: number };

    expect(destination._periodicFlush).toBeGreaterThan(0);
  });

  it('should return undefined, when pino-pretty owns the output', () => {
    const destination = createPinoDestination({
      level: 'debug',
      transport: 'pretty',
      serviceName: 'api-gateway',
    });

    expect(destination).toBeUndefined();
  });
});
