import { type INestApplication, HttpStatus } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { Test, type TestingModule } from '@nestjs/testing';
import { ResponseEnvelopeModule } from '@task1/shared/api-response/response-envelope.module';
import loggerConfig from '@task1/shared/config/logger.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/http/exception-handling.module';
import { RequestContextModule } from '@task1/shared/request-context/http/request-context.module';
import { of, throwError } from 'rxjs';
import request from 'supertest';

import { AuthModule } from '../auth/auth.module.js';
import rabbitmqConfig from '../config/rabbitmq.config.js';
import redisConfig from '../config/redis.config.js';
import { ContractModule } from '../contract/contract.module.js';
import { SERVICE_A_RMQ_CLIENT, SERVICE_B_RMQ_CLIENT } from '../rmq/rmq-client.tokens.js';
import { RmqClientsModule } from '../rmq/rmq-clients.module.js';

import { type IAggregatedHealth } from './health-check.service.js';
import { HealthModule } from './health.module.js';
import { REDIS_CLIENT } from './infra-clients.tokens.js';

type App = Parameters<typeof request>[0];

describe('HealthController (HTTP Integration)', () => {
  let app: INestApplication;
  let httpServer: App;
  let serviceAClient: { send: ReturnType<typeof vi.fn> };
  let serviceBClient: { send: ReturnType<typeof vi.fn> };
  let redisClient: { ping: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    serviceAClient = { send: vi.fn() };
    serviceBClient = { send: vi.fn() };
    redisClient = { ping: vi.fn() };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [rabbitmqConfig, loggerConfig, redisConfig],
        }),
        RequestContextModule,
        ExceptionHandlingModule,
        ResponseEnvelopeModule,
        AuthModule,
        ContractModule,
        RmqClientsModule,
        HealthModule,
      ],
    })
      .overrideProvider(SERVICE_A_RMQ_CLIENT)
      .useValue(serviceAClient as unknown as ClientProxy)
      .overrideProvider(SERVICE_B_RMQ_CLIENT)
      .useValue(serviceBClient as unknown as ClientProxy)
      .overrideProvider(REDIS_CLIENT)
      .useValue(redisClient)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    httpServer = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();

    serviceAClient.send.mockReturnValue(of({ status: 'ok' }));
    serviceBClient.send.mockReturnValue(of({ status: 'ok' }));
    redisClient.ping.mockResolvedValue('PONG');
  });

  describe('GET /health', () => {
    it('should return 200 and status ok, when every dependency is healthy', async () => {
      const response = await request(httpServer).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'SUCCESS',
        code: 200,
        message: 'OK',
        result: {
          data: {
            status: 'ok',
            services: {
              gateway: 'ok',
              rabbitmq: 'ok',
              serviceA: 'ok',
              serviceB: 'ok',
              redis: 'ok',
            },
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any(String) is typed `any` by vitest; value is asserted at runtime, not statically typeable.
        meta: { tracing: { correlationId: expect.any(String) } },
      });
    });

    it('should return 200 and status degraded, when service-b is unavailable', async () => {
      serviceBClient.send.mockReturnValue(throwError(() => new Error('connection refused')));

      const response = await request(httpServer).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'SUCCESS',
        code: 200,
        message: 'OK',
        result: {
          data: {
            status: 'degraded',
            services: {
              gateway: 'ok',
              rabbitmq: 'ok',
              serviceA: 'ok',
              serviceB: 'unavailable',
              redis: 'ok',
            },
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any(String) is typed `any` by vitest; value is asserted at runtime, not statically typeable.
        meta: { tracing: { correlationId: expect.any(String) } },
      });
    });
  });

  describe('GET /health/live', () => {
    it('should return 200 and status ok, without checking any dependency', async () => {
      const response = await request(httpServer).get('/health/live');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'SUCCESS',
        code: 200,
        message: 'OK',
        result: { data: { status: 'ok', service: 'gateway' } },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any(String) is typed `any` by vitest; value is asserted at runtime, not statically typeable.
        meta: { tracing: { correlationId: expect.any(String) } },
      });
      expect(serviceAClient.send).not.toHaveBeenCalled();
    });
  });

  describe('GET /health/ready', () => {
    it('should return 503, when redis is down', async () => {
      redisClient.ping.mockRejectedValue(new Error('connection refused'));

      const response = await request(httpServer).get('/health/ready');

      expect(response.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(
        (response.body as { result: { data: IAggregatedHealth } }).result.data.services.redis,
      ).toBe('unavailable');
    });

    it('should return 503, when service-a is unavailable', async () => {
      serviceAClient.send.mockReturnValue(throwError(() => new Error('connection refused')));

      const response = await request(httpServer).get('/health/ready');

      expect(response.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(
        (response.body as { result: { data: IAggregatedHealth } }).result.data.services.serviceA,
      ).toBe('unavailable');
    });

    it('should return a SUCCESS envelope with code 503, when a critical dependency is down', async () => {
      serviceAClient.send.mockReturnValue(throwError(() => new Error('connection refused')));

      const response = await request(httpServer).get('/health/ready');

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        status: 'SUCCESS',
        code: 503,
        message: 'OK',
      });
      expect((response.body as { result: { data: IAggregatedHealth } }).result.data.status).toBe(
        'degraded',
      );
    });
  });
});
