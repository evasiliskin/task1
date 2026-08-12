import { type HealthIndicatorService } from '@nestjs/terminus';
import { type AmqpConnectionManager } from 'amqp-connection-manager';

import { RabbitMqConnectionHealthIndicator } from './rabbitmq-connection.health-indicator';

describe('RabbitMqConnectionHealthIndicator', () => {
  let upMock: ReturnType<typeof vi.fn>;
  let downMock: ReturnType<typeof vi.fn>;
  let healthIndicatorService: HealthIndicatorService;

  beforeEach(() => {
    upMock = vi.fn();
    downMock = vi.fn();
    healthIndicatorService = {
      check: vi.fn().mockReturnValue({ up: upMock, down: downMock }),
    };
  });

  it('should report the indicator as up, when the broker connection is open', () => {
    const expectedResult = { rabbitmq: { status: 'up' } };
    upMock.mockReturnValue(expectedResult);

    const connectionManager = {
      isConnected: vi.fn().mockReturnValue(true),
    } as unknown as AmqpConnectionManager;
    const indicator = new RabbitMqConnectionHealthIndicator(
      healthIndicatorService,
      connectionManager,
    );

    expect(indicator.isHealthy('rabbitmq')).toEqual(expectedResult);
  });

  it('should report the indicator as down, when the broker connection is closed', () => {
    const expectedResult = {
      rabbitmq: { status: 'down', message: 'not connected to the RabbitMQ broker' },
    };
    downMock.mockReturnValue(expectedResult);

    const connectionManager = {
      isConnected: vi.fn().mockReturnValue(false),
    } as unknown as AmqpConnectionManager;
    const indicator = new RabbitMqConnectionHealthIndicator(
      healthIndicatorService,
      connectionManager,
    );

    expect(indicator.isHealthy('rabbitmq')).toEqual(expectedResult);
    expect(downMock).toHaveBeenCalledWith({ message: 'not connected to the RabbitMQ broker' });
  });

  it('should close the underlying connection manager, when the module is destroyed', async () => {
    const closeMock = vi.fn().mockResolvedValue(undefined);
    const connectionManager = {
      isConnected: vi.fn(),
      close: closeMock,
    } as unknown as AmqpConnectionManager;
    const indicator = new RabbitMqConnectionHealthIndicator(
      healthIndicatorService,
      connectionManager,
    );

    await indicator.onModuleDestroy();

    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
