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
import { SERVICE_A_RMQ_CLIENT } from '../rmq/rmq-client.tokens.js';
import { RmqClientsModule } from '../rmq/rmq-clients.module.js';

import { EventsModule } from './events.module.js';

type App = Parameters<typeof request>[0];

describe('EventsController (HTTP Integration)', () => {
  let app: INestApplication;
  let httpServer: App;
  let serviceAClient: { send: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    serviceAClient = { send: vi.fn() };

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
        EventsModule,
      ],
    })
      .overrideProvider(SERVICE_A_RMQ_CLIENT)
      .useValue(serviceAClient as unknown as ClientProxy)
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

  describe('GET /events', () => {
    it('should return 200 with the mapped events and nextCursor, when service-a replies successfully', async () => {
      serviceAClient.send.mockReturnValue(
        of({
          data: [
            {
              eventId: 'e1',
              eventType: 'PushEvent',
              createdAt: '2026-08-11T00:00:00.000Z',
              actor: { id: 1, login: 'octocat' },
              repo: { id: 2, name: 'octocat/hello-world' },
              importId: 'import-1',
              payload: { ref: 'refs/heads/main', commitCount: 1 },
            },
          ],
          nextCursor: 'some-cursor',
        }),
      );

      const response = await request(httpServer).get('/events').query({ type: 'PushEvent' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'SUCCESS',
        code: 200,
        message: 'OK',
        result: {
          items: [
            {
              eventId: 'e1',
              eventType: 'PushEvent',
              createdAt: '2026-08-11T00:00:00.000Z',
              actor: { id: 1, login: 'octocat' },
              repo: { id: 2, name: 'octocat/hello-world' },
              importId: 'import-1',
              payload: { ref: 'refs/heads/main', commitCount: 1 },
            },
          ],
          pagination: { nextCursor: 'some-cursor' },
        },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any(String) is typed `any` by vitest; value is asserted at runtime, not statically typeable.
        meta: { tracing: { correlationId: expect.any(String) } },
      });
    });

    it('should forward the query filters and default limit inside the RMQ message, when a search is performed', async () => {
      serviceAClient.send.mockReturnValue(of({ data: [] }));

      await request(httpServer).get('/events').query({ type: 'PushEvent' });

      const [pattern, record] = serviceAClient.send.mock.calls[0] as [
        string,
        { data: { type: string; limit: number } },
      ];
      expect(pattern).toBe('events.search');
      expect(record.data).toEqual(expect.objectContaining({ type: 'PushEvent', limit: 50 }));
    });

    it('should send a message record whose headers include a correlation id, when a search is performed', async () => {
      serviceAClient.send.mockReturnValue(of({ data: [] }));

      await request(httpServer).get('/events');

      const [, record] = serviceAClient.send.mock.calls[0] as [
        string,
        { options: { headers: Record<string, string> } },
      ];
      expect(typeof record.options.headers['x-correlation-id']).toBe('string');
    });

    it('should return 400 and not call service-a, when limit exceeds 200', async () => {
      const response = await request(httpServer).get('/events').query({ limit: '201' });

      expect(response.status).toBe(400);
      expect(serviceAClient.send).not.toHaveBeenCalled();
    });

    it('should return 400 and not call service-a, when an unknown query parameter is provided', async () => {
      const response = await request(httpServer).get('/events').query({ unknown: 'value' });

      expect(response.status).toBe(400);
      expect(serviceAClient.send).not.toHaveBeenCalled();
    });
  });
});
