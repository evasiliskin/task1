import { type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { Test, type TestingModule } from '@nestjs/testing';
import loggerConfig from '@task1/shared/config/logger.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/http/exception-handling.module';
import { ResponseEnvelopeModule } from '@task1/shared/exception-handling/http/response-envelope.module';
import { RequestContextModule } from '@task1/shared/request-context/http/request-context.module';
import { of } from 'rxjs';
import request from 'supertest';

import { AuthGuard } from '../auth/auth.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import rabbitmqConfig from '../config/rabbitmq.config.js';
import { ContractModule } from '../contract/contract.module.js';
import { SERVICE_B_RMQ_CLIENT } from '../rmq/rmq-client.tokens.js';
import { RmqClientsModule } from '../rmq/rmq-clients.module.js';

import { LogsModule } from './logs.module.js';

type App = Parameters<typeof request>[0];

describe('LogsController (HTTP Integration)', () => {
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
        LogsModule,
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

  describe('GET /logs', () => {
    it('should return 200 with the mapped logs and nextCursor, when service-b replies successfully', async () => {
      serviceBClient.send.mockReturnValue(
        of({
          data: [
            {
              importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
              eventType: 'github.import.completed',
              service: 'service-a',
              status: 'completed',
              timestamp: '2026-08-11T00:05:00.000Z',
              correlationId: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
              archive: '2026-08-11-0.json.gz',
              metadata: { eventsProcessed: 10, validEvents: 8 },
            },
          ],
          nextCursor: 'some-cursor',
        }),
      );

      const response = await request(httpServer).get('/logs').query({ status: 'completed' });

      expect(response.status).toBe(200);
      expect((response.body as { result: { items: unknown } }).result.items).toEqual([
        {
          importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          eventType: 'github.import.completed',
          service: 'service-a',
          status: 'completed',
          timestamp: '2026-08-11T00:05:00.000Z',
          correlationId: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          archive: '2026-08-11-0.json.gz',
          metadata: { eventsProcessed: 10, validEvents: 8 },
        },
      ]);
      expect(
        (response.body as { result: { pagination: { nextCursor?: string } } }).result.pagination
          .nextCursor,
      ).toBe('some-cursor');
      expect(response.body).toMatchObject({ status: 'SUCCESS', code: 200, message: 'OK' });
      expect(
        (response.body as { meta: { tracing: { correlationId: string } } }).meta.tracing
          .correlationId,
      ).toEqual(expect.any(String));
    });

    it('should forward the query filters and default limit inside the RMQ message, when a search is performed', async () => {
      serviceBClient.send.mockReturnValue(of({ data: [] }));

      await request(httpServer).get('/logs').query({ status: 'completed' });

      const [pattern, record] = serviceBClient.send.mock.calls[0] as [
        string,
        { data: { status: string; limit: number } },
      ];
      expect(pattern).toBe('logs.search');
      expect(record.data).toEqual(expect.objectContaining({ status: 'completed', limit: 50 }));
    });

    it('should send a message record whose headers include a correlation id, when a search is performed', async () => {
      serviceBClient.send.mockReturnValue(of({ data: [] }));

      await request(httpServer).get('/logs');

      const [, record] = serviceBClient.send.mock.calls[0] as [
        string,
        { options: { headers: Record<string, string> } },
      ];
      expect(typeof record.options.headers['x-correlation-id']).toBe('string');
    });

    it('should return 400 and not call service-b, when limit exceeds 200', async () => {
      const response = await request(httpServer).get('/logs').query({ limit: '201' });

      expect(response.status).toBe(400);
      expect(serviceBClient.send).not.toHaveBeenCalled();
    });

    it('should return 400 and not call service-b, when an unknown query parameter is provided', async () => {
      const response = await request(httpServer).get('/logs').query({ unknown: 'value' });

      expect(response.status).toBe(400);
      expect(serviceBClient.send).not.toHaveBeenCalled();
    });
  });
});
