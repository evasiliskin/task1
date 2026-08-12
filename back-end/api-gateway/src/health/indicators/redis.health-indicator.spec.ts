import { type ConfigType } from '@nestjs/config';
import { type HealthIndicatorService } from '@nestjs/terminus';
import { type Redis } from 'ioredis';

import type redisConfig from '../../config/redis.config';

import { RedisHealthIndicator } from './redis.health-indicator';

describe('RedisHealthIndicator', () => {
  let upMock: ReturnType<typeof vi.fn>;
  let downMock: ReturnType<typeof vi.fn>;
  let healthIndicatorService: HealthIndicatorService;
  const config = { pingTimeoutMs: 3000 } as ConfigType<typeof redisConfig>;

  beforeEach(() => {
    upMock = vi.fn();
    downMock = vi.fn();
    healthIndicatorService = {
      check: vi.fn().mockReturnValue({ up: upMock, down: downMock }),
    };
  });

  it('should report the indicator as up, when ping resolves', async () => {
    const expectedResult = { redis: { status: 'up' } };
    upMock.mockReturnValue(expectedResult);

    const client = { ping: vi.fn().mockResolvedValue('PONG') } as unknown as Redis;

    const indicator = new RedisHealthIndicator(healthIndicatorService, client, config);

    expect(await indicator.isHealthy('redis')).toEqual(expectedResult);
  });

  it('should report the indicator as down, when ping rejects', async () => {
    const expectedResult = { redis: { status: 'down', message: 'connection refused' } };
    downMock.mockReturnValue(expectedResult);

    const client = {
      ping: vi.fn().mockRejectedValue(new Error('connection refused')),
    } as unknown as Redis;

    const indicator = new RedisHealthIndicator(healthIndicatorService, client, config);

    expect(await indicator.isHealthy('redis')).toEqual(expectedResult);
  });
});
