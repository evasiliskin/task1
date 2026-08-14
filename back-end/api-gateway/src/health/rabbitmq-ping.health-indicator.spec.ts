import { type ConfigType } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { type HealthIndicatorService } from '@nestjs/terminus';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { NEVER, of, throwError } from 'rxjs';

import type rabbitmqConfig from '../config/rabbitmq.config.js';

import { RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator.js';

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

  it('should report the indicator as up, when the target service replies to health.check', async () => {
    const expectedResult = { 'service-b': { status: 'up' } };
    upMock.mockReturnValue(expectedResult);

    const client = {
      send: vi.fn().mockReturnValue(of({ status: 'ok' })),
    } as unknown as ClientProxy;

    const result = await runWithinContext(() => indicator.isHealthy('service-b', client));

    expect(result).toEqual(expectedResult);
  });

  it('should report the indicator as down, when the target service errors', async () => {
    const expectedResult = {
      'service-b': { status: 'down', message: 'connection refused' },
    };
    downMock.mockReturnValue(expectedResult);

    const client = {
      send: vi.fn().mockReturnValue(throwError(() => new Error('connection refused'))),
    } as unknown as ClientProxy;

    const result = await runWithinContext(() => indicator.isHealthy('service-b', client));

    expect(result).toEqual(expectedResult);
  });

  it('should report the indicator as down with unknown error, when the target service throws a non-Error value', async () => {
    const expectedResult = {
      'service-a': { status: 'down', message: 'unknown error' },
    };
    downMock.mockReturnValue(expectedResult);

    const client = {
      send: vi.fn().mockReturnValue(throwError(() => 'timeout')),
    } as unknown as ClientProxy;

    const result = await runWithinContext(() => indicator.isHealthy('service-a', client));

    expect(result).toEqual(expectedResult);
  });

  it('should send a message record whose headers forward the active correlation id and a fresh request id', async () => {
    upMock.mockReturnValue({ 'service-b': { status: 'up' } });

    const send = vi.fn().mockReturnValue(of({ status: 'ok' }));
    const client = { send } as unknown as ClientProxy;

    await runWithinContext(() => indicator.isHealthy('service-b', client));

    expect(send).toHaveBeenCalledWith(
      'health.check',
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        options: expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          headers: expect.objectContaining({
            'x-correlation-id': 'c-123',
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            'x-request-id': expect.any(String),
          }),
        }),
      }),
    );

    const [, record] = send.mock.calls[0] as [
      string,
      { options: { headers: Record<string, string> } },
    ];
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

  it('should report the indicator as down, when the target service does not reply within the configured timeout', async () => {
    const expectedResult = { 'service-b': { status: 'down', message: 'timed out' } };
    downMock.mockReturnValue(expectedResult);

    const healthIndicatorService = {
      check: vi.fn().mockReturnValue({ up: upMock, down: downMock }),
    } as unknown as HealthIndicatorService;

    const shortTimeoutIndicator = new RabbitMqPingHealthIndicator(
      healthIndicatorService,
      requestContextService,
      {
        pingTimeoutMs: 10,
      } as ConfigType<typeof rabbitmqConfig>,
    );

    const client = {
      send: vi.fn().mockReturnValue(NEVER),
    } as unknown as ClientProxy;

    const result = await runWithinContext(() =>
      shortTimeoutIndicator.isHealthy('service-b', client),
    );

    expect(result).toEqual(expectedResult);
    expect(downMock).toHaveBeenCalledWith(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({ message: expect.any(String) }),
    );
  });
});
