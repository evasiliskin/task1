import { LoggerFlushService } from './logger-flush.service.js';
import { type IFlushableDestination } from './pino-destination.factory.js';

describe('LoggerFlushService', () => {
  it('should flush the destination, when the application shuts down', () => {
    const destination = { flushSync: vi.fn(), write: vi.fn() } as unknown as IFlushableDestination;

    new LoggerFlushService(destination).onApplicationShutdown();

    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(destination.flushSync).toHaveBeenCalledTimes(1);
  });

  it('should do nothing, when no destination is configured', () => {
    expect(() => new LoggerFlushService().onApplicationShutdown()).not.toThrow();
  });
});
