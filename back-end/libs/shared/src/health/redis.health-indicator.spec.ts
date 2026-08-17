import { RedisHealthIndicator } from './redis.health-indicator.js';

function buildIndicatorService() {
  const up = vi.fn().mockReturnValue({ redis: { status: 'up' } });
  const down = vi.fn().mockReturnValue({ redis: { status: 'down' } });

  return { check: () => ({ up, down }), up, down };
}

describe('RedisHealthIndicator', () => {
  it('should report up, when the ping command succeeds', async () => {
    const service = buildIndicatorService();
    const ping = vi.fn().mockResolvedValue('PONG');
    const indicator = new RedisHealthIndicator(service as never, { ping } as never);

    await indicator.isHealthy('redis', 1000);

    expect(ping).toHaveBeenCalled();
    expect(service.up).toHaveBeenCalled();
  });

  it('should report down with the error message, when the ping fails', async () => {
    const service = buildIndicatorService();
    const indicator = new RedisHealthIndicator(
      service as never,
      {
        ping: vi.fn().mockRejectedValue(new Error('connection refused')),
      } as never,
    );

    await indicator.isHealthy('redis', 1000);

    expect(service.down).toHaveBeenCalledWith({ message: 'connection refused' });
  });

  it('should report down, when the ping exceeds the timeout', async () => {
    const service = buildIndicatorService();
    const indicator = new RedisHealthIndicator(
      service as never,
      {
        ping: () => new Promise(() => undefined),
      } as never,
    );

    await indicator.isHealthy('redis', 20);

    expect(service.down).toHaveBeenCalled();
  });
});
