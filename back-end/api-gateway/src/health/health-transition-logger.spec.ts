import {
  HEALTH_CHECK_FAILED_LOG,
  HEALTH_CHECK_RECOVERED_LOG,
  HealthTransitionLogger,
} from './health-transition-logger.js';

function buildLogger() {
  const error = vi.fn();
  const info = vi.fn();

  return { logger: new HealthTransitionLogger({ error, info } as never), error, info };
}

const down = { redis: { status: 'down', message: 'ECONNREFUSED' } } as never;
const up = { redis: { status: 'up' } } as never;

describe('HealthTransitionLogger', () => {
  it('should log the first time a dependency goes down', () => {
    const { logger, error } = buildLogger();

    logger.record(down, 12);

    expect(error).toHaveBeenCalledWith(
      { dependency: 'redis', errorMessage: 'ECONNREFUSED', responseTimeMs: 12 },
      HEALTH_CHECK_FAILED_LOG,
    );
  });

  it('should not repeat the line while the dependency stays down', () => {
    const { logger, error } = buildLogger();

    logger.record(down, 12);
    logger.record(down, 13);
    logger.record(down, 14);

    expect(error).toHaveBeenCalledTimes(1);
  });

  it('should log once when the dependency recovers', () => {
    const { logger, info } = buildLogger();

    logger.record(down, 12);
    logger.record(up, 9);
    logger.record(up, 8);

    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      { dependency: 'redis', responseTimeMs: 9 },
      HEALTH_CHECK_RECOVERED_LOG,
    );
  });

  it('should log nothing while everything stays up', () => {
    const { logger, error, info } = buildLogger();

    logger.record(up, 5);
    logger.record(up, 6);

    expect(error).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it('should track dependencies independently', () => {
    const { logger, error } = buildLogger();

    logger.record({ redis: { status: 'down' }, serviceA: { status: 'up' } } as never, 5);
    logger.record({ redis: { status: 'down' }, serviceA: { status: 'down' } } as never, 5);

    expect(error).toHaveBeenCalledTimes(2);
  });
});
