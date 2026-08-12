import { type INestApplication, HttpStatus } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { Test, type TestingModule } from '@nestjs/testing';
import loggerConfig from '@task1/shared/config/logger.config';
import { RequestContextModule } from '@task1/shared/request-context/http/request-context.module';
import { of, throwError } from 'rxjs';
import request from 'supertest';
import type { App } from 'supertest/types';

import mongodbConfig from '../config/mongodb.config.js';
import rabbitmqConfig from '../config/rabbitmq.config.js';
import redisConfig from '../config/redis.config.js';

import { type IAggregatedHealth } from './health-check.service.js';
import { HealthModule } from './health.module.js';
import { MONGO_CLIENT, REDIS_CLIENT } from './infra-clients.tokens.js';
import {
  RABBITMQ_CONNECTION_MANAGER,
  SERVICE_A_RMQ_CLIENT,
  SERVICE_B_RMQ_CLIENT,
} from './rabbitmq-clients.tokens.js';

describe('HealthController (HTTP Integration)', () => {
  let app: INestApplication;
  let serviceAClient: { send: ReturnType<typeof vi.fn> };
  let serviceBClient: { send: ReturnType<typeof vi.fn> };
  let connectionManager: { isConnected: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  let mongoClient: { db: ReturnType<typeof vi.fn> };
  let redisClient: { ping: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    serviceAClient = { send: vi.fn() };
    serviceBClient = { send: vi.fn() };
    connectionManager = { isConnected: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
    mongoClient = { db: vi.fn() };
    redisClient = { ping: vi.fn() };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [rabbitmqConfig, loggerConfig, mongodbConfig, redisConfig],
        }),
        RequestContextModule,
        HealthModule,
      ],
    })
      .overrideProvider(SERVICE_A_RMQ_CLIENT)
      .useValue(serviceAClient as unknown as ClientProxy)
      .overrideProvider(SERVICE_B_RMQ_CLIENT)
      .useValue(serviceBClient as unknown as ClientProxy)
      .overrideProvider(RABBITMQ_CONNECTION_MANAGER)
      .useValue(connectionManager)
      .overrideProvider(MONGO_CLIENT)
      .useValue(mongoClient)
      .overrideProvider(REDIS_CLIENT)
      .useValue(redisClient)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();

    serviceAClient.send.mockReturnValue(of({ status: 'ok' }));
    serviceBClient.send.mockReturnValue(of({ status: 'ok' }));
    connectionManager.isConnected.mockReturnValue(true);
    mongoClient.db.mockReturnValue({ command: vi.fn().mockResolvedValue({ ok: 1 }) });
    redisClient.ping.mockResolvedValue('PONG');
  });

  describe('GET /health', () => {
    it('should return 200 and status ok, when every dependency is healthy', async () => {
      const response = await request(app.getHttpServer() as App).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        services: {
          gateway: 'ok',
          rabbitmq: 'ok',
          serviceA: 'ok',
          serviceB: 'ok',
          mongodb: 'ok',
          redis: 'ok',
        },
      });
    });

    it('should return 200 and status degraded, when service-b is unavailable', async () => {
      serviceBClient.send.mockReturnValue(throwError(() => new Error('connection refused')));

      const response = await request(app.getHttpServer() as App).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'degraded',
        services: {
          gateway: 'ok',
          rabbitmq: 'ok',
          serviceA: 'ok',
          serviceB: 'unavailable',
          mongodb: 'ok',
          redis: 'ok',
        },
      });
    });
  });

  describe('GET /health/live', () => {
    it('should return 200 and status ok, without checking any dependency', async () => {
      const response = await request(app.getHttpServer() as App).get('/health/live');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok', service: 'gateway' });
      expect(serviceAClient.send).not.toHaveBeenCalled();
    });
  });

  describe('GET /health/ready', () => {
    it('should return 200, when all critical dependencies are healthy even if redis is down', async () => {
      redisClient.ping.mockRejectedValue(new Error('connection refused'));

      const response = await request(app.getHttpServer() as App).get('/health/ready');

      expect(response.status).toBe(200);
      expect((response.body as IAggregatedHealth).services.redis).toBe('unavailable');
    });

    it('should return 503, when service-a is unavailable', async () => {
      serviceAClient.send.mockReturnValue(throwError(() => new Error('connection refused')));

      const response = await request(app.getHttpServer() as App).get('/health/ready');

      expect(response.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect((response.body as IAggregatedHealth).services.serviceA).toBe('unavailable');
    });
  });
});
