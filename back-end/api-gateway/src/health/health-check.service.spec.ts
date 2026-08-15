import { ServiceUnavailableException } from '@nestjs/common';
import { type ClientProxy } from '@nestjs/microservices';
import { type HealthCheckService as TerminusHealthCheckService } from '@nestjs/terminus';
import { type LoggerService } from '@task1/shared/logger/logger.service';

import { HealthCheckService } from './health-check.service.js';
import { type GatewayHealthIndicator } from './indicators/gateway.health-indicator.js';
import { type RabbitMqConnectionHealthIndicator } from './indicators/rabbitmq-connection.health-indicator.js';
import { type RedisHealthIndicator } from './indicators/redis.health-indicator.js';
import { type RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator.js';

const ALL_KEYS = ['gateway', 'rabbitmq', 'serviceA', 'serviceB', 'redis'];

const ALL_UP_DETAILS = Object.fromEntries(ALL_KEYS.map((key) => [key, { status: 'up' }]));

function buildService(
  overrides: {
    terminusCheck?: ReturnType<typeof vi.fn>;
    error?: ReturnType<typeof vi.fn>;
  } = {},
): HealthCheckService {
  const { terminusCheck = vi.fn().mockRejectedValue(buildRejection(['redis'])), error = vi.fn() } =
    overrides;
  const terminus = { check: terminusCheck } as unknown as TerminusHealthCheckService;
  const loggerService = {
    getLogger: vi.fn().mockReturnValue({
      error,
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
    }),
  } as unknown as LoggerService;

  return new HealthCheckService(
    terminus,
    {} as GatewayHealthIndicator,
    {} as RabbitMqConnectionHealthIndicator,
    {} as RabbitMqPingHealthIndicator,
    {} as RedisHealthIndicator,
    {} as ClientProxy,
    {} as ClientProxy,
    loggerService,
  );
}

function buildRejection(downKeys: readonly string[]): ServiceUnavailableException {
  const entries = ALL_KEYS.map((key): [string, { status: 'up' | 'down'; message?: string }] =>
    downKeys.includes(key)
      ? [key, { status: 'down', message: 'connection refused' }]
      : [key, { status: 'up' }],
  );

  const details = Object.fromEntries(entries);
  const info = Object.fromEntries(entries.filter(([, value]) => value.status === 'up'));
  const error = Object.fromEntries(entries.filter(([, value]) => value.status === 'down'));

  return new ServiceUnavailableException({ status: 'error', info, error, details });
}

describe('HealthCheckService', () => {
  describe('getHealth', () => {
    it('should return status ok with every service ok, when everything is healthy', async () => {
      const terminusCheck = vi.fn().mockResolvedValue({
        status: 'ok',
        info: ALL_UP_DETAILS,
        error: {},
        details: ALL_UP_DETAILS,
      });

      const result = await buildService({ terminusCheck }).getHealth();

      expect(result).toEqual({
        status: 'ok',
        services: {
          gateway: 'ok',
          rabbitmq: 'ok',
          serviceA: 'ok',
          serviceB: 'ok',
          redis: 'ok',
        },
      });
    });

    it('should mark serviceA as unavailable and report the rest as ok, when service-a is unavailable', async () => {
      const terminusCheck = vi.fn().mockRejectedValue(buildRejection(['serviceA']));

      const result = await buildService({ terminusCheck }).getHealth();

      expect(result).toEqual({
        status: 'degraded',
        services: {
          gateway: 'ok',
          rabbitmq: 'ok',
          serviceA: 'unavailable',
          serviceB: 'ok',
          redis: 'ok',
        },
      });
    });

    it('should mark serviceB as unavailable and report the rest as ok, when service-b is unavailable', async () => {
      const terminusCheck = vi.fn().mockRejectedValue(buildRejection(['serviceB']));

      const result = await buildService({ terminusCheck }).getHealth();

      expect(result.services).toEqual({
        gateway: 'ok',
        rabbitmq: 'ok',
        serviceA: 'ok',
        serviceB: 'unavailable',
        redis: 'ok',
      });
    });

    it('should mark rabbitmq as unavailable and report the rest as ok, when the broker is unreachable', async () => {
      const terminusCheck = vi.fn().mockRejectedValue(buildRejection(['rabbitmq']));

      const result = await buildService({ terminusCheck }).getHealth();

      expect(result.services).toEqual({
        gateway: 'ok',
        rabbitmq: 'unavailable',
        serviceA: 'ok',
        serviceB: 'ok',
        redis: 'ok',
      });
    });

    it('should mark redis as unavailable and report the rest as ok, when Redis is unreachable', async () => {
      const terminusCheck = vi.fn().mockRejectedValue(buildRejection(['redis']));

      const result = await buildService({ terminusCheck }).getHealth();

      expect(result.services).toEqual({
        gateway: 'ok',
        rabbitmq: 'ok',
        serviceA: 'ok',
        serviceB: 'ok',
        redis: 'unavailable',
      });
    });

    it('should mark serviceB as unavailable, when its ping times out (indistinguishable from any other failure at this layer)', async () => {
      const terminusCheck = vi.fn().mockRejectedValue(buildRejection(['serviceB']));

      const result = await buildService({ terminusCheck }).getHealth();

      expect(result.status).toBe('degraded');
      expect(result.services.serviceB).toBe('unavailable');
    });

    it('should mark both serviceB and redis as unavailable independently, when both are down simultaneously', async () => {
      const terminusCheck = vi.fn().mockRejectedValue(buildRejection(['serviceB', 'redis']));

      const result = await buildService({ terminusCheck }).getHealth();

      expect(result).toEqual({
        status: 'degraded',
        services: {
          gateway: 'ok',
          rabbitmq: 'ok',
          serviceA: 'ok',
          serviceB: 'unavailable',
          redis: 'unavailable',
        },
      });
    });

    it('should log the failure with service name and error, and not log for services that are up, when a dependency is down', async () => {
      const terminusCheck = vi.fn().mockRejectedValue(buildRejection(['serviceB']));
      const loggerErrorMock = vi.fn();

      await buildService({ terminusCheck, error: loggerErrorMock }).getHealth();

      expect(loggerErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'serviceB',
          errorMessage: 'connection refused',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          responseTimeMs: expect.any(Number),
        }),
        expect.stringContaining('serviceB'),
      );
    });

    it('should not duplicate the correlation fields the pino mixin already stamps', async () => {
      const error = vi.fn();
      const service = buildService({ error });

      await service.getHealth();

      const [fields] = error.mock.calls[0] as [Record<string, unknown>];

      expect(fields).toMatchObject({
        service: 'redis',
        responseTimeMs: expect.any(Number) as number,
      });
      expect(fields).not.toHaveProperty('correlationId');
      expect(fields).not.toHaveProperty('requestId');
    });
  });

  describe('getReadiness', () => {
    it('should be ready, when only redis (non-critical) is unavailable', async () => {
      const terminusCheck = vi.fn().mockRejectedValue(buildRejection(['redis']));

      const { ready, result } = await buildService({ terminusCheck }).getReadiness();

      expect(ready).toBe(true);
      expect(result.services.redis).toBe('unavailable');
    });

    it('should not be ready, when service-a (critical) is unavailable', async () => {
      const terminusCheck = vi.fn().mockRejectedValue(buildRejection(['serviceA']));

      const { ready } = await buildService({ terminusCheck }).getReadiness();

      expect(ready).toBe(false);
    });

    it('should not be ready, when rabbitmq (critical) is unavailable even if redis (non-critical) is also down', async () => {
      const terminusCheck = vi.fn().mockRejectedValue(buildRejection(['rabbitmq', 'redis']));

      const { ready, result } = await buildService({ terminusCheck }).getReadiness();

      expect(ready).toBe(false);
      expect(result.services.redis).toBe('unavailable');
    });
  });

  describe('getLiveness', () => {
    it('should always return status ok without checking any dependency', () => {
      const terminusCheck = vi.fn();

      const result = buildService({ terminusCheck }).getLiveness();

      expect(result).toEqual({ status: 'ok', service: 'gateway' });
      expect(terminusCheck).not.toHaveBeenCalled();
    });
  });
});
