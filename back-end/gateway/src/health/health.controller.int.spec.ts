import { type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { Test, type TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import request from 'supertest';
import type { App } from 'supertest/types';

import rabbitmqConfig from '../config/rabbitmq.config';
import { RequestContextModule } from '../core/request-context/request-context.module';

import { HealthModule } from './health.module';
import { SERVICE_A_RMQ_CLIENT, SERVICE_B_RMQ_CLIENT } from './rabbitmq-clients.tokens';

describe('HealthController (HTTP Integration)', () => {
  let app: INestApplication;
  let serviceBClient: { send: ReturnType<typeof vi.fn> };
  let serviceAClient: { send: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    serviceBClient = { send: vi.fn() };
    serviceAClient = { send: vi.fn() };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [rabbitmqConfig] }),
        RequestContextModule,
        HealthModule,
      ],
    })
      .overrideProvider(SERVICE_B_RMQ_CLIENT)
      .useValue(serviceBClient as unknown as ClientProxy)
      .overrideProvider(SERVICE_A_RMQ_CLIENT)
      .useValue(serviceAClient)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /health/service-b', () => {
    it('should return 200 and health check result, when service-b replies', async () => {
      serviceBClient.send.mockReturnValue(of({ status: 'ok' }));

      const response = await request(app.getHttpServer() as App).get('/health/service-b');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        info: { 'service-b': { status: 'up' } },
        error: {},
        details: { 'service-b': { status: 'up' } },
      });
    });

    it('should return 503 and health check result, when service-b does not reply', async () => {
      serviceBClient.send.mockReturnValue(throwError(() => new Error('connection refused')));

      const response = await request(app.getHttpServer() as App).get('/health/service-b');

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        status: 'error',
        info: {},
        error: { 'service-b': { message: 'connection refused', status: 'down' } },
        details: { 'service-b': { message: 'connection refused', status: 'down' } },
      });
    });

    it('should echo the incoming x-correlation-id and generate an x-request-id, when service-b replies', async () => {
      serviceBClient.send.mockReturnValue(of({ status: 'ok' }));

      const response = await request(app.getHttpServer() as App)
        .get('/health/service-b')
        .set('x-correlation-id', '11111111-1111-4111-8111-111111111111');

      expect(response.headers['x-correlation-id']).toBe('11111111-1111-4111-8111-111111111111');
      expect(response.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe('GET /health/service-a', () => {
    it('should return 200 and health check result, when service-a replies', async () => {
      serviceAClient.send.mockReturnValue(of({ status: 'ok' }));

      const response = await request(app.getHttpServer() as App).get('/health/service-a');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        info: { 'service-a': { status: 'up' } },
        error: {},
        details: { 'service-a': { status: 'up' } },
      });
    });

    it('should return 503 and health check result, when service-a does not reply', async () => {
      serviceAClient.send.mockReturnValue(throwError(() => new Error('connection refused')));

      const response = await request(app.getHttpServer() as App).get('/health/service-a');

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        status: 'error',
        info: {},
        error: { 'service-a': { message: 'connection refused', status: 'down' } },
        details: { 'service-a': { message: 'connection refused', status: 'down' } },
      });
    });

    it('should generate both response headers, when no tracing headers are sent by the client', async () => {
      serviceAClient.send.mockReturnValue(of({ status: 'ok' }));

      const response = await request(app.getHttpServer() as App).get('/health/service-a');

      expect(response.headers['x-correlation-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(response.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });
});
