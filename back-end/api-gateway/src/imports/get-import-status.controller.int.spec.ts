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
import storageConfig from '../config/storage.config.js';
import uploadConfig from '../config/upload.config.js';
import { ContractModule } from '../contract/contract.module.js';
import { SERVICE_A_RMQ_CLIENT } from '../rmq/rmq-client.tokens.js';
import { RmqClientsModule } from '../rmq/rmq-clients.module.js';

import { ImportsModule } from './imports.module.js';

type App = Parameters<typeof request>[0];

describe('GetImportStatusController (HTTP Integration)', () => {
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
          load: [storageConfig, uploadConfig, rabbitmqConfig, loggerConfig],
        }),
        RequestContextModule,
        ExceptionHandlingModule,
        ResponseEnvelopeModule,
        AuthModule,
        ContractModule,
        RmqClientsModule,
        ImportsModule,
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

  describe('GET /imports/:importId', () => {
    const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

    it('should return 200 with the mapped status, when service-a finds the import', async () => {
      serviceAClient.send.mockReturnValue(
        of({
          importId,
          source: { type: 'download', archive: '2026-08-11-0.json.gz' },
          status: 'completed',
          startedAt: '2026-08-11T00:00:00.000Z',
          completedAt: '2026-08-11T00:05:00.000Z',
          eventsProcessed: 10,
          validEvents: 10,
          invalidEvents: 0,
          duplicateEvents: 0,
          errorCount: 0,
        }),
      );

      const response = await request(httpServer).get(`/imports/${importId}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ status: 'SUCCESS', code: 200, message: 'OK' });
      expect(
        (response.body as { result: { data: { importId: string; status: string } } }).result.data
          .importId,
      ).toBe(importId);
      expect(
        (response.body as { result: { data: { importId: string; status: string } } }).result.data
          .status,
      ).toBe('completed');
    });

    it('should send the imports.status.get pattern with the importId, when called', async () => {
      serviceAClient.send.mockReturnValue(
        of({
          importId,
          source: { type: 'download', archive: '2026-08-11-0.json.gz' },
          status: 'started',
          startedAt: '2026-08-11T00:00:00.000Z',
        }),
      );

      await request(httpServer).get(`/imports/${importId}`);

      const [pattern, record] = serviceAClient.send.mock.calls[0] as [
        string,
        { data: { importId: string } },
      ];
      expect(pattern).toBe('imports.status.get');
      expect(record.data).toEqual({ importId });
    });

    it('should return 404, when service-a replies null', async () => {
      serviceAClient.send.mockReturnValue(of(null));

      const response = await request(httpServer).get(`/imports/${importId}`);

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        status: 'FAILED',
        code: 404,
        reason: 'IMPORT_NOT_FOUND',
      });
      expect((response.body as { details?: unknown }).details).toBeUndefined();
    });

    it('should return 400 and not call service-a, when importId is not a valid UUID', async () => {
      const response = await request(httpServer).get('/imports/not-a-uuid');

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        status: 'FAILED',
        code: 400,
        reason: 'REQUEST_CONTRACT_VIOLATION',
      });
      expect(serviceAClient.send).not.toHaveBeenCalled();
    });
  });
});
