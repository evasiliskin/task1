import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { Test, type TestingModule } from '@nestjs/testing';
import loggerConfig from '@task1/shared/config/logger.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/http/exception-handling.module';
import { RequestContextModule } from '@task1/shared/request-context/http/request-context.module';
import { of } from 'rxjs';
import request from 'supertest';

import { AuthGuard } from '../auth/auth.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import rabbitmqConfig from '../config/rabbitmq.config.js';

import { SERVICE_B_RMQ_CLIENT } from './rabbitmq-client.token.js';
import { StatsModule } from './stats.module.js';

type App = Parameters<typeof request>[0];

describe('StatsController (HTTP Integration)', () => {
  let app: INestApplication;
  let httpServer: App;
  let serviceBClient: { send: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    serviceBClient = { send: vi.fn() };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [rabbitmqConfig, loggerConfig],
        }),
        RequestContextModule,
        ExceptionHandlingModule,
        AuthModule,
        StatsModule,
      ],
    })
      .overrideProvider(SERVICE_B_RMQ_CLIENT)
      .useValue(serviceBClient as unknown as ClientProxy)
      .overrideProvider(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    httpServer = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /stats', () => {
    const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

    it('should return 200 with aggregate stats, when no importId is given', async () => {
      serviceBClient.send.mockReturnValue(
        of({
          archivesProcessed: 12,
          eventsProcessed: 48_000,
          successfulEvents: 47_500,
          invalidEvents: 500,
          errors: 3,
          processingDurationMs: 15_230,
          timeSeries: [{ timestamp: '2026-08-11T00:00:00.000Z', value: 100 }],
        }),
      );

      const response = await request(httpServer).get('/stats');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        archivesProcessed: 12,
        eventsProcessed: 48_000,
        successfulEvents: 47_500,
        invalidEvents: 500,
        errors: 3,
        processingDurationMs: 15_230,
        timeSeries: [{ timestamp: '2026-08-11T00:00:00.000Z', value: 100 }],
      });
    });

    it('should return 200 without processingDurationMs, when service-b omits it', async () => {
      serviceBClient.send.mockReturnValue(
        of({
          archivesProcessed: 0,
          eventsProcessed: 0,
          successfulEvents: 0,
          invalidEvents: 0,
          errors: 0,
          timeSeries: [],
        }),
      );

      const response = await request(httpServer).get('/stats');

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('processingDurationMs');
    });

    it('should forward importId inside the RMQ message, when provided', async () => {
      serviceBClient.send.mockReturnValue(
        of({
          archivesProcessed: 1,
          eventsProcessed: 1,
          successfulEvents: 1,
          invalidEvents: 0,
          errors: 0,
          timeSeries: [],
        }),
      );

      await request(httpServer).get('/stats').query({ importId });

      const [pattern, record] = serviceBClient.send.mock.calls[0] as [
        string,
        { data: { importId: string } },
      ];
      expect(pattern).toBe('stats.get');
      expect(record.data).toEqual({ importId });
    });

    it('should send a message record whose headers include a correlation id, when a request is made', async () => {
      serviceBClient.send.mockReturnValue(
        of({
          archivesProcessed: 0,
          eventsProcessed: 0,
          successfulEvents: 0,
          invalidEvents: 0,
          errors: 0,
          timeSeries: [],
        }),
      );

      await request(httpServer).get('/stats');

      const [, record] = serviceBClient.send.mock.calls[0] as [
        string,
        { options: { headers: Record<string, string> } },
      ];
      expect(typeof record.options.headers['x-correlation-id']).toBe('string');
    });

    it('should return 400 and not call service-b, when importId is not a uuid', async () => {
      const response = await request(httpServer).get('/stats').query({ importId: 'not-a-uuid' });

      expect(response.status).toBe(400);
      expect(serviceBClient.send).not.toHaveBeenCalled();
    });

    it('should return 400 and not call service-b, when an unknown query parameter is provided', async () => {
      const response = await request(httpServer).get('/stats').query({ unknown: 'value' });

      expect(response.status).toBe(400);
      expect(serviceBClient.send).not.toHaveBeenCalled();
    });
  });
});
