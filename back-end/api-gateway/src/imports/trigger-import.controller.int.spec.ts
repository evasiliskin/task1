import { type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { Test, type TestingModule } from '@nestjs/testing';
import { ResponseEnvelopeModule } from '@task1/shared/api-response/response-envelope.module';
import loggerConfig from '@task1/shared/config/logger.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/http/exception-handling.module';
import { LoggerService } from '@task1/shared/logger/http/logger.service';
import { RequestContextModule } from '@task1/shared/request-context/http/request-context.module';
import { of, throwError } from 'rxjs';
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
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- local destructuring shape for the mocked emit() call, not a domain interface.
type EmittedMessage = { importId: string; dateHour: string };
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- local destructuring shape for the enveloped response body, not a domain interface.
type ImportIdEnvelope = { result: { data: { importId: string } } };

describe('TriggerImportController (HTTP Integration)', () => {
  let app: INestApplication;
  let httpServer: App;
  let serviceAClient: { emit: ReturnType<typeof vi.fn> };
  let loggerSpy: {
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
  };

  beforeAll(async () => {
    serviceAClient = { emit: vi.fn(() => of(undefined)) };
    loggerSpy = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };

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
      .overrideProvider(LoggerService)
      .useValue({ getLogger: () => loggerSpy })
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

  describe('POST /imports', () => {
    it('should return 202 with a generated importId and emit the download trigger, when no Idempotency-Key is supplied', async () => {
      const response = await request(httpServer)
        .post('/imports')
        .send({ dateHour: '2026-08-11-0' });

      expect(response.status).toBe(202);
      expect(response.body).toMatchObject({ status: 'SUCCESS', code: 202, message: 'OK' });
      expect(typeof (response.body as ImportIdEnvelope).result.data.importId).toBe('string');
      expect(serviceAClient.emit).toHaveBeenCalledTimes(1);

      const [pattern, payload] = serviceAClient.emit.mock.calls[0] as [string, EmittedMessage];

      expect(pattern).toBe('archive.import.download');
      expect(payload.importId).toBe((response.body as ImportIdEnvelope).result.data.importId);
      expect(payload.dateHour).toBe('2026-08-11-0');
    });

    it('should use the Idempotency-Key as the importId, when a valid UUID key is supplied', async () => {
      const idempotencyKey = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

      const response = await request(httpServer)
        .post('/imports')
        .set('Idempotency-Key', idempotencyKey)
        .send({ dateHour: '2026-08-11-0' });

      expect(response.status).toBe(202);
      expect((response.body as ImportIdEnvelope).result.data.importId).toBe(idempotencyKey);

      const [, payload] = serviceAClient.emit.mock.calls[0] as [string, EmittedMessage];

      expect(payload.importId).toBe(idempotencyKey);
    });

    it('should return the same importId and emit again with the same importId, when the same Idempotency-Key is replayed', async () => {
      const idempotencyKey = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

      const first = await request(httpServer)
        .post('/imports')
        .set('Idempotency-Key', idempotencyKey)
        .send({ dateHour: '2026-08-11-0' });
      const second = await request(httpServer)
        .post('/imports')
        .set('Idempotency-Key', idempotencyKey)
        .send({ dateHour: '2026-08-11-0' });

      expect((first.body as ImportIdEnvelope).result.data.importId).toBe(idempotencyKey);
      expect((second.body as ImportIdEnvelope).result.data.importId).toBe(idempotencyKey);
      expect(serviceAClient.emit).toHaveBeenCalledTimes(2);
      // Replay-safety itself (skipping a second real import) is enforced inside
      // service-a's DownloadImportController (Task 10) via the imports collection —
      // the gateway's only job is deterministic importId resolution, asserted above.
    });

    it('should return 400 and not emit, when the Idempotency-Key is not a valid UUID', async () => {
      const response = await request(httpServer)
        .post('/imports')
        .set('Idempotency-Key', 'not-a-uuid')
        .send({ dateHour: '2026-08-11-0' });

      expect(response.status).toBe(400);
      expect(serviceAClient.emit).not.toHaveBeenCalled();
    });

    it('should return 400 and not emit, when dateHour does not match the required format', async () => {
      const response = await request(httpServer)
        .post('/imports')
        .send({ dateHour: 'not-a-date-hour' });

      expect(response.status).toBe(400);
      expect(serviceAClient.emit).not.toHaveBeenCalled();
    });

    it('should return 400 and not emit, when dateHour is missing', async () => {
      const response = await request(httpServer).post('/imports').send({});

      expect(response.status).toBe(400);
      expect(serviceAClient.emit).not.toHaveBeenCalled();
    });

    it('should still return 202 but log an error, when publishing to service-a fails', async () => {
      const publishError = new Error('broker unavailable');
      serviceAClient.emit.mockReturnValue(throwError(() => publishError));

      await request(httpServer).post('/imports').send({ dateHour: '2026-08-11-0' }).expect(202);

      expect(loggerSpy.error).toHaveBeenCalledWith(
        expect.objectContaining({ pattern: 'archive.import.download' }),
        'Failed to publish message to service-a',
        expect.anything(),
      );
    });
  });
});
