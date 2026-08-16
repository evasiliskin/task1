import { MongoHealthIndicator } from './mongo.health-indicator.js';

function buildIndicatorService() {
  const up = vi.fn().mockReturnValue({ mongodb: { status: 'up' } });
  const down = vi.fn().mockReturnValue({ mongodb: { status: 'down' } });

  return { check: () => ({ up, down }), up, down };
}

describe('MongoHealthIndicator', () => {
  it('should report up when the ping command succeeds', async () => {
    const service = buildIndicatorService();
    const command = vi.fn().mockResolvedValue({ ok: 1 });
    const indicator = new MongoHealthIndicator(
      service as never,
      {
        db: () => ({ command }),
      } as never,
    );

    await indicator.isHealthy('mongodb', 1000);

    expect(command).toHaveBeenCalledWith({ ping: 1 });
    expect(service.up).toHaveBeenCalled();
  });

  it('should report down with the error message when the ping fails', async () => {
    const service = buildIndicatorService();
    const indicator = new MongoHealthIndicator(
      service as never,
      {
        db: () => ({ command: vi.fn().mockRejectedValue(new Error('no primary')) }),
      } as never,
    );

    await indicator.isHealthy('mongodb', 1000);

    expect(service.down).toHaveBeenCalledWith({ message: 'no primary' });
  });

  it('should report down when the ping exceeds the timeout', async () => {
    const service = buildIndicatorService();
    const indicator = new MongoHealthIndicator(
      service as never,
      {
        db: () => ({ command: () => new Promise(() => undefined) }),
      } as never,
    );

    await indicator.isHealthy('mongodb', 20);

    expect(service.down).toHaveBeenCalled();
  });
});
