import { type ConfigType } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { type HealthIndicatorService } from '@nestjs/terminus';
import { of, throwError } from 'rxjs';

import type rabbitmqConfig from '../config/rabbitmq.config';
import { RequestContextService } from '../core/request-context/request-context.service';

import { RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator';

describe('RabbitMqPingHealthIndicator', () => {
  let indicator: RabbitMqPingHealthIndicator;
  let requestContextService: RequestContextService;
  let upMock: ReturnType<typeof vi.fn>;
  let downMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    upMock = vi.fn();
    downMock = vi.fn();

    const healthIndicatorService = {
      check: vi.fn().mockReturnValue({ up: upMock, down: downMock }),
    } as unknown as HealthIndicatorService;

    requestContextService = new RequestContextService();

    indicator = new RabbitMqPingHealthIndicator(healthIndicatorService, requestContextService, {
      pingTimeoutMs: 3000,
    } as ConfigType<typeof rabbitmqConfig>);
  });

  const runWithinContext = <T>(callback: () => T): T =>
    requestContextService.run({ correlationId: 'c-123', requestId: 'r-inbound' }, callback);

  it('should report the indicator as up, when service-b replies to health.check', async () => {
    const expectedResult = { 'service-b': { status: 'up' } };
    upMock.mockReturnValue(expectedResult);

    const client = {
      send: vi.fn().mockReturnValue(of({ status: 'ok' })),
    } as unknown as ClientProxy;

    const result = await runWithinContext(() => indicator.isHealthy('service-b', client));

    expect(result).toEqual(expectedResult);
  });

  it('should report the indicator as down, when service-b errors', async () => {
    const expectedResult = { 'service-b': { status: 'down', message: 'connection refused' } };
    downMock.mockReturnValue(expectedResult);

    const client = {
      send: vi.fn().mockReturnValue(throwError(() => new Error('connection refused'))),
    } as unknown as ClientProxy;

    const result = await runWithinContext(() => indicator.isHealthy('service-b', client));

    expect(result).toEqual(expectedResult);
  });

  it('should send a message record whose headers forward the active correlation id and a fresh request id', async () => {
    upMock.mockReturnValue({ 'service-b': { status: 'up' } });

    const send = vi.fn().mockReturnValue(of({ status: 'ok' }));
    const client = { send } as unknown as ClientProxy;

    await runWithinContext(() => indicator.isHealthy('service-b', client));

    const [pattern, record] = send.mock.calls[0] as [
      string,
      { options: { headers: Record<string, string> } },
    ];

    expect(pattern).toBe('health.check');
    expect(record.options.headers['x-correlation-id']).toBe('c-123');
    expect(record.options.headers['x-request-id']).not.toBe('r-inbound');
  });

  it('should throw MissingRequestContextError, when called outside of any request context', async () => {
    const client = {
      send: vi.fn().mockReturnValue(of({ status: 'ok' })),
    } as unknown as ClientProxy;

    await expect(indicator.isHealthy('service-b', client)).rejects.toThrow(
      'RequestContextService was accessed outside of an active request context',
    );
  });
});
