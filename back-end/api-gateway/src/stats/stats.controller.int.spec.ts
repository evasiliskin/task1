import { type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { Test, type TestingModule } from '@nestjs/testing';
import { ResponseEnvelopeModule } from '@task1/shared/api-response/response-envelope.module';
import loggerConfig from '@task1/shared/config/logger.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/http/exception-handling.module';
import { RequestContextModule } from '@task1/shared/request-context/http/request-context.module';
import { of } from 'rxjs';
import request from 'supertest';

import { AuthGuard } from '../auth/auth.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import rabbitmqConfig from '../config/rabbitmq.config.js';
import { ContractModule } from '../contract/contract.module.js';
import { SERVICE_B_RMQ_CLIENT } from '../rmq/rmq-client.tokens.js';
import { RmqClientsModule } from '../rmq/rmq-clients.module.js';

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
        ResponseEnvelopeModule,
        AuthModule,
        ContractModule,
        RmqClientsModule,
        StatsModule,
      ],
    })
      .overrideProvider(SERVICE_B_RMQ_CLIENT)
      .useValue(serviceBClient as unknown as ClientProxy)
      .overrideProvider(AuthGuard)
      .useValue({ canActivate: () => true })
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
        status: 'SUCCESS',
        code: 200,
        message: 'OK',
        result: {
          data: {
            archivesProcessed: 12,
            eventsProcessed: 48_000,
            successfulEvents: 47_500,
            invalidEvents: 500,
            errors: 3,
            processingDurationMs: 15_230,
            timeSeries: [{ timestamp: '2026-08-11T00:00:00.000Z', value: 100 }],
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any(String) is typed `any` by vitest; value is asserted at runtime, not statically typeable.
        meta: { tracing: { correlationId: expect.any(String) } },
      });
    });

    it('should pass through degraded: true from service-b, when the upstream response includes it', async () => {
      serviceBClient.send.mockReturnValue(
        of({
          archivesProcessed: 0,
          eventsProcessed: 0,
          successfulEvents: 0,
          invalidEvents: 0,
          errors: 0,
          timeSeries: [],
          degraded: true,
        }),
      );

      const response = await request(httpServer).get('/stats');

      expect(response.status).toBe(200);
      expect(
        (response.body as { result: { data: { degraded?: boolean } } }).result.data,
      ).toHaveProperty('degraded', true);
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
      expect((response.body as { result: { data: unknown } }).result.data).not.toHaveProperty(
        'processingDurationMs',
      );
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

    it('should return a FAILED envelope with checksFailed, when importId is not a uuid', async () => {
      const response = await request(httpServer).get('/stats').query({ importId: 'not-a-uuid' });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        status: 'FAILED',
        code: 400,
        reason: 'REQUEST_CONTRACT_VIOLATION',
        message: 'Request validation failed',
      });
      expect(
        (response.body as { details: { checksFailed: { field: string }[] } }).details
          .checksFailed[0].field,
      ).toBe('importId');
    });

    it('should not wrap a contract violation as a success envelope, when validation fails', async () => {
      const response = await request(httpServer).get('/stats').query({ unknown: 'value' });

      expect(response.status).toBe(400);
      expect((response.body as { status: string }).status).toBe('FAILED');
      expect(response.body).not.toHaveProperty('result');
    });
  });
});
