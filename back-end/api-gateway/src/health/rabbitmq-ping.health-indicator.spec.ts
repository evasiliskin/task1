import { type ConfigType } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { type HealthIndicatorService } from '@nestjs/terminus';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { ContextPropagatingClient } from '@task1/shared/request-context/rmq/context-propagating.client';
import { NEVER, of, throwError } from 'rxjs';

import type rabbitmqConfig from '../config/rabbitmq.config.js';

import { RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator.js';

describe('RabbitMqPingHealthIndicator', () => {
  let indicator: RabbitMqPingHealthIndicator;
  let requestContextService: RequestContextService;
  let propagatingClient: ContextPropagatingClient;
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
    propagatingClient = new ContextPropagatingClient(requestContextService);

    indicator = new RabbitMqPingHealthIndicator(healthIndicatorService, propagatingClient, {
      pingTimeoutMs: 3000,
    } as ConfigType<typeof rabbitmqConfig>);
  });

  const runWithinContext = <T>(callback: () => T): T =>
    requestContextService.run(
      {
        correlationId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        correlationIdSource: 'inbound',
      },
      callback,
    );

  it('should report the indicator as up, when the target service replies to health.check', async () => {
    const expectedResult = { 'service-b': { status: 'up' } };
    upMock.mockReturnValue(expectedResult);

    const client = {
      send: vi.fn().mockReturnValue(of({ status: 'ok' })),
    } as unknown as ClientProxy;

    const result = await runWithinContext(() => indicator.isHealthy('service-b', client));

    expect(result).toEqual(expectedResult);
  });

  it('should report the indicator as down with the reported details, when the target service replies that its own dependencies are unhealthy', async () => {
    const expectedResult = { 'service-b': { status: 'down' } };
    downMock.mockReturnValue(expectedResult);

    const details = { mongodb: { status: 'down' }, redis: { status: 'up' } };
    const client = {
      send: vi.fn().mockReturnValue(of({ status: 'error', details })),
    } as unknown as ClientProxy;

    const result = await runWithinContext(() => indicator.isHealthy('service-b', client));

    expect(result).toEqual(expectedResult);
    expect(downMock).toHaveBeenCalledWith({ message: expect.any(String) as string, details });
    expect(upMock).not.toHaveBeenCalled();
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

  it('should forward the active correlation id and a fresh request id, when it pings a service', async () => {
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
            'x-correlation-id': 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
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
    expect(record.options.headers['x-request-id']).not.toBe('7c9e6679-7425-40de-944b-e07fc1f90ae7');
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
      propagatingClient,
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
