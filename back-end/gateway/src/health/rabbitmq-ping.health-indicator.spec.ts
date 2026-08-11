import { type ClientProxy } from '@nestjs/microservices';
import { TerminusModule } from '@nestjs/terminus';
import { Test, type TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';

import { RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator';

describe('RabbitMqPingHealthIndicator', () => {
  let indicator: RabbitMqPingHealthIndicator;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule],
      providers: [RabbitMqPingHealthIndicator],
    }).compile();

    indicator = moduleRef.get(RabbitMqPingHealthIndicator);
  });

  it('should report the indicator as up, when the target service replies to health.check', async () => {
    const client = { send: () => of({ status: 'ok' }) } as unknown as ClientProxy;

    const result = await indicator.isHealthy('users-service', client);

    expect(result['users-service'].status).toBe('up');
  });

  it('should report the indicator as down, when the target service errors or times out', async () => {
    const client = {
      send: () => throwError(() => new Error('connection refused')),
    } as unknown as ClientProxy;

    const result = await indicator.isHealthy('users-service', client);

    expect(result['users-service'].status).toBe('down');
  });
});
