import { ServiceUnavailableException } from '@nestjs/common';

import { DependencyHealthService } from './dependency-health.service.js';

describe('DependencyHealthService', () => {
  it('should check mongodb and redis with the supplied timeout, when invoked', async () => {
    const check = vi.fn().mockResolvedValue({ status: 'ok', details: {} });
    const mongo = { isHealthy: vi.fn().mockResolvedValue({}) };
    const redis = { isHealthy: vi.fn().mockResolvedValue({}) };

    const service = new DependencyHealthService({ check } as never, mongo as never, redis as never);

    await service.check(1234);

    expect(check).toHaveBeenCalledTimes(1);

    const [indicators] = check.mock.calls[0] as [(() => unknown)[]];

    indicators.forEach((indicator) => indicator());

    expect(mongo.isHealthy).toHaveBeenCalledWith('mongodb', 1234);
    expect(redis.isHealthy).toHaveBeenCalledWith('redis', 1234);
  });

  it('should recover the result body, when Terminus throws for a down dependency', async () => {
    const body = { status: 'error', details: { mongodb: { status: 'down' } } };
    const check = vi.fn().mockRejectedValue(new ServiceUnavailableException(body));

    const service = new DependencyHealthService(
      { check } as never,
      { isHealthy: vi.fn() } as never,
      { isHealthy: vi.fn() } as never,
    );

    await expect(service.check(1000)).resolves.toEqual(body);
  });

  it('should rethrow the error, when it is not a Terminus health-check failure', async () => {
    const check = vi.fn().mockRejectedValue(new TypeError('bad indicator'));

    const service = new DependencyHealthService(
      { check } as never,
      { isHealthy: vi.fn() } as never,
      { isHealthy: vi.fn() } as never,
    );

    await expect(service.check(1000)).rejects.toBeInstanceOf(TypeError);
  });
});
