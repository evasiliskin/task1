import { ServiceUnavailableException } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { type HealthCheckService as TerminusHealthCheckService } from '@nestjs/terminus';
import { type RedisHealthIndicator } from '@task1/shared/health/redis.health-indicator';
import { type LoggerService } from '@task1/shared/logger/logger.service';

import { type default as redisConfig } from '../config/redis.config.js';

import {
  HEALTH_CHECK_FAILED_LOG,
  HEALTH_CHECK_RECOVERED_LOG,
  HealthCheckService,
} from './health-check.service.js';
import { type GatewayHealthIndicator } from './indicators/gateway.health-indicator.js';
import { type RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator.js';

const ALL_KEYS = ['gateway', 'rabbitmq', 'serviceA', 'serviceB', 'redis'];

const ALL_UP_DETAILS = Object.fromEntries(ALL_KEYS.map((key) => [key, { status: 'up' }]));

function downResult(key: string) {
  return {
    status: 'error' as const,
    info: Object.fromEntries(ALL_KEYS.filter((k) => k !== key).map((k) => [k, { status: 'up' }])),
    error: { [key]: { status: 'down' as const, message: 'connection refused' } },
    details: Object.fromEntries(
      ALL_KEYS.map((k) =>
        k === key
          ? [k, { status: 'down' as const, message: 'connection refused' }]
          : [k, { status: 'up' }],
      ),
    ),
  };
}

function allUpResult() {
  return {
    status: 'ok' as const,
    info: ALL_UP_DETAILS,
    error: {},
    details: ALL_UP_DETAILS,
  };
}

function buildService(
  overrides: {
    terminusCheck?: ReturnType<typeof vi.fn>;
    error?: ReturnType<typeof vi.fn>;
    info?: ReturnType<typeof vi.fn>;
    gatewayIndicator?: { isHealthy: ReturnType<typeof vi.fn> };
    redisIndicator?: { isHealthy: ReturnType<typeof vi.fn> };
    redisConfiguration?: ConfigType<typeof redisConfig>;
    pingResults?: { serviceA?: 'up' | 'down'; serviceB?: 'down' | 'up' };
  } = {},
): HealthCheckService {
  const {
    error = vi.fn(),
    info = vi.fn(),
    gatewayIndicator = { isHealthy: vi.fn().mockResolvedValue({ gateway: { status: 'up' } }) },
    redisIndicator = { isHealthy: vi.fn().mockResolvedValue({ redis: { status: 'up' } }) },
    redisConfiguration = { pingTimeoutMs: 3000 } as ConfigType<typeof redisConfig>,
    pingResults = {},
  } = overrides;
  const {
    terminusCheck = vi.fn().mockImplementation(async (indicatorFns: (() => Promise<object>)[]) => {
      const results = await Promise.all(indicatorFns.map((fn) => fn()));
      const details = results.reduce<Record<string, unknown>>(
        (accumulated, result) => ({ ...accumulated, ...result }),
        {},
      );

      return { status: 'ok', details };
    }),
  } = overrides;
  const terminus = { check: terminusCheck } as unknown as TerminusHealthCheckService;
  const loggerService = {
    getLogger: vi.fn().mockReturnValue({
      error,
      warn: vi.fn(),
      info,
      debug: vi.fn(),
      trace: vi.fn(),
    }),
  } as unknown as LoggerService;

  const { serviceA: serviceAPingStatus = 'up', serviceB: serviceBPingStatus = 'up' } = pingResults;
  const rabbitMqPingIndicator = {
    isHealthy: vi.fn().mockImplementation((name: 'serviceA' | 'serviceB') => ({
      [name]: { status: name === 'serviceA' ? serviceAPingStatus : serviceBPingStatus },
    })),
  };

  return new HealthCheckService(
    terminus,
    gatewayIndicator as unknown as GatewayHealthIndicator,
    rabbitMqPingIndicator as unknown as RabbitMqPingHealthIndicator,
    redisIndicator as unknown as RedisHealthIndicator,
    redisConfiguration,
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
          dependency: 'serviceB',
          errorMessage: 'connection refused',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          responseTimeMs: expect.any(Number),
        }),
        expect.any(String),
      );
    });

    it('should log only the dependency fields, when the pino mixin already stamps correlation fields', async () => {
      const terminusCheck = vi.fn().mockRejectedValue(buildRejection(['redis']));
      const error = vi.fn();
      const service = buildService({ terminusCheck, error });

      await service.getHealth();

      const [fields] = error.mock.calls[0] as [Record<string, unknown>];

      expect(fields).toMatchObject({
        dependency: 'redis',
        responseTimeMs: expect.any(Number) as number,
      });
      expect(fields).not.toHaveProperty('correlationId');
      expect(fields).not.toHaveProperty('requestId');
    });

    it('should log a down dependency once, when the same failure is polled repeatedly', async () => {
      const terminusCheck = vi.fn().mockResolvedValue(downResult('redis'));
      const error = vi.fn();
      const service = buildService({ terminusCheck, error });

      await service.getHealth();
      await service.getHealth();
      await service.getHealth();

      const errorLines = (error.mock.calls as [Record<string, unknown>, string][]).map(
        ([fields, message]) => ({
          message,
          fields,
        }),
      );

      expect(errorLines).toHaveLength(1);
      expect(errorLines[0]).toMatchObject({
        message: HEALTH_CHECK_FAILED_LOG,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        fields: expect.objectContaining({ dependency: 'redis' }),
      });
    });

    it('should ping redis with the configured timeout, when a health check runs', async () => {
      const redisIndicator = { isHealthy: vi.fn().mockResolvedValue({ redis: { status: 'up' } }) };
      const service = buildService({
        redisIndicator,
        redisConfiguration: { pingTimeoutMs: 1500 },
      });

      await service.getHealth();

      expect(redisIndicator.isHealthy).toHaveBeenCalledWith('redis', 1500);
    });

    it('should report rabbitmq as ok, when at least one service ping succeeds', async () => {
      const service = buildService({
        pingResults: { serviceA: 'up', serviceB: 'down' },
      });

      const result = await service.getHealth();

      expect(result.services.rabbitmq).toBe('ok');
      expect(result.services.serviceB).toBe('unavailable');
    });

    it('should report rabbitmq as unavailable, when no service ping succeeds', async () => {
      const service = buildService({ pingResults: { serviceA: 'down', serviceB: 'down' } });

      expect((await service.getHealth()).services.rabbitmq).toBe('unavailable');
    });

    it('should log recovery, when a previously down dependency comes back', async () => {
      const terminusCheck = vi.fn();
      const error = vi.fn();
      const info = vi.fn();

      terminusCheck.mockResolvedValueOnce(downResult('redis'));
      const service = buildService({ terminusCheck, error, info });
      await service.getHealth();

      terminusCheck.mockResolvedValueOnce(allUpResult());
      await service.getHealth();

      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({ dependency: 'redis' }),
        HEALTH_CHECK_RECOVERED_LOG,
      );
    });

    it('should run a single check, when probes overlap', async () => {
      let release = (): void => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const isHealthy = vi.fn().mockImplementation(async () => {
        await gate;

        return { gateway: { status: 'up' } };
      });
      const service = buildService({ gatewayIndicator: { isHealthy } });

      const first = service.getHealth();
      const second = service.getHealth();

      release();
      await Promise.all([first, second]);

      expect(isHealthy).toHaveBeenCalledTimes(1);
    });

    it('should run a fresh check, when the previous one has settled', async () => {
      const service = buildService({});

      await service.getHealth();
      await service.getHealth();

      expect(service.hasCheckInFlight()).toBe(false);
    });

    it('should not reuse a failed check, when a later probe arrives', async () => {
      const isHealthy = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({});
      const service = buildService({ gatewayIndicator: { isHealthy } });

      await expect(service.getHealth()).rejects.toThrow('boom');
      await expect(service.getHealth()).resolves.toBeDefined();
    });
  });

  describe('getReadiness', () => {
    it('should not be ready, when redis is down', async () => {
      const service = buildService({
        redisIndicator: { isHealthy: vi.fn().mockResolvedValue({ redis: { status: 'down' } }) },
      });

      const { ready, result } = await service.getReadiness();

      expect(ready).toBe(false);
      expect(result.services.redis).toBe('unavailable');
    });

    it('should be ready, when every dependency is up', async () => {
      const { ready } = await buildService({}).getReadiness();

      expect(ready).toBe(true);
    });

    it('should not be ready, when service-a (critical) is unavailable', async () => {
      const terminusCheck = vi.fn().mockRejectedValue(buildRejection(['serviceA']));

      const { ready } = await buildService({ terminusCheck }).getReadiness();

      expect(ready).toBe(false);
    });

    it('should not be ready, when rabbitmq (critical) is unavailable even if redis is also down', async () => {
      const terminusCheck = vi.fn().mockRejectedValue(buildRejection(['rabbitmq', 'redis']));

      const { ready, result } = await buildService({ terminusCheck }).getReadiness();

      expect(ready).toBe(false);
      expect(result.services.redis).toBe('unavailable');
    });
  });

  describe('getLiveness', () => {
    it('should return status ok without checking any dependency, when liveness is requested', () => {
      const terminusCheck = vi.fn();

      const result = buildService({ terminusCheck }).getLiveness();

      expect(result).toEqual({ status: 'ok', service: 'gateway' });
      expect(terminusCheck).not.toHaveBeenCalled();
    });
  });
});
