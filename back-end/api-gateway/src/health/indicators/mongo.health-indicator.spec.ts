import { type ConfigType } from '@nestjs/config';
import { type HealthIndicatorService } from '@nestjs/terminus';
import { type MongoClient } from 'mongodb';

import type mongodbConfig from '../../config/mongodb.config.js';

import { MongoHealthIndicator } from './mongo.health-indicator.js';

describe('MongoHealthIndicator', () => {
  let upMock: ReturnType<typeof vi.fn>;
  let downMock: ReturnType<typeof vi.fn>;
  let healthIndicatorService: HealthIndicatorService;
  const config = { pingTimeoutMs: 3000 } as ConfigType<typeof mongodbConfig>;

  beforeEach(() => {
    upMock = vi.fn();
    downMock = vi.fn();
    healthIndicatorService = {
      check: vi.fn().mockReturnValue({ up: upMock, down: downMock }),
    };
  });

  it('should report the indicator as up, when the ping command resolves', async () => {
    const expectedResult = { mongodb: { status: 'up' } };
    upMock.mockReturnValue(expectedResult);

    const client = {
      db: vi.fn().mockReturnValue({ command: vi.fn().mockResolvedValue({ ok: 1 }) }),
    } as unknown as MongoClient;

    const indicator = new MongoHealthIndicator(healthIndicatorService, client, config);

    expect(await indicator.isHealthy('mongodb')).toEqual(expectedResult);
  });

  it('should report the indicator as down, when the ping command rejects', async () => {
    const expectedResult = { mongodb: { status: 'down', message: 'connection refused' } };
    downMock.mockReturnValue(expectedResult);

    const client = {
      db: vi
        .fn()
        .mockReturnValue({ command: vi.fn().mockRejectedValue(new Error('connection refused')) }),
    } as unknown as MongoClient;

    const indicator = new MongoHealthIndicator(healthIndicatorService, client, config);

    expect(await indicator.isHealthy('mongodb')).toEqual(expectedResult);
  });
});
