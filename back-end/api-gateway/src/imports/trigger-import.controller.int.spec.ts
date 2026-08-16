import { type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { Test, type TestingModule } from '@nestjs/testing';
import { ResponseEnvelopeModule } from '@task1/shared/api-response/response-envelope.module';
import loggerConfig from '@task1/shared/config/logger.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/http/exception-handling.module';
import { LoggerService } from '@task1/shared/logger/logger.service';
import { RequestContextModule } from '@task1/shared/request-context/http/request-context.module';
import { Observable, of, throwError } from 'rxjs';
import request from 'supertest';

import { AuthGuard } from '../auth/auth.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import rabbitmqConfig from '../config/rabbitmq.config.js';
import storageConfig from '../config/storage.config.js';
import uploadConfig from '../config/upload.config.js';
import { ContractModule } from '../contract/contract.module.js';
import { SERVICE_A_IMPORTS_RMQ_CLIENT, SERVICE_A_RMQ_CLIENT } from '../rmq/rmq-client.tokens.js';
import { RmqClientsModule } from '../rmq/rmq-clients.module.js';

import { ImportsModule } from './imports.module.js';

type App = Parameters<typeof request>[0];
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- local destructuring shape for the mocked emit() call's RmqRecord, not a domain interface.
type EmittedRecord = { data: { importId: string; dateHour: string } };
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- local destructuring shape for the enveloped response body, not a domain interface.
type ImportIdEnvelope = { result: { data: { importId: string } } };

describe('TriggerImportController (HTTP Integration)', () => {
  let app: INestApplication;
  let httpServer: App;
  let serviceAImportsClient: { emit: ReturnType<typeof vi.fn> };
  let serviceAClient: { send: ReturnType<typeof vi.fn> };
  let loggerSpy: {
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    isLevelEnabled: ReturnType<typeof vi.fn>;
  };

  beforeAll(async () => {
    // Keeps the claim-RPC-timeout test fast: the real default (10s) would make that single test
    // slow without adding coverage — only that the timeout() operator fires and gets mapped.
    process.env.RABBITMQ_RPC_TIMEOUT_MS = '50';

    serviceAImportsClient = { emit: vi.fn(() => of(undefined)) };
    serviceAClient = {
      send: vi.fn(() => of({ importId: '11111111-1111-4111-8111-111111111111' })),
    };
    loggerSpy = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      isLevelEnabled: vi.fn(() => false),
    };

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
      .overrideProvider(SERVICE_A_IMPORTS_RMQ_CLIENT)
      .useValue(serviceAImportsClient as unknown as ClientProxy)
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
    delete process.env.RABBITMQ_RPC_TIMEOUT_MS;
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    serviceAImportsClient.emit.mockReturnValue(of(undefined));
    serviceAClient.send.mockReturnValue(of({ importId: '11111111-1111-4111-8111-111111111111' }));
  });

  describe('POST /imports', () => {
    it('should return 202 with a generated importId and emit the download trigger, when no Idempotency-Key is supplied', async () => {
      const response = await request(httpServer)
        .post('/imports')
        .send({ dateHour: '2026-08-11-0' });

      expect(response.status).toBe(202);
      expect(response.body).toMatchObject({ status: 'SUCCESS', code: 202, message: 'OK' });
      expect(typeof (response.body as ImportIdEnvelope).result.data.importId).toBe('string');
      expect(serviceAImportsClient.emit).toHaveBeenCalledTimes(1);

      const [pattern, record] = serviceAImportsClient.emit.mock.calls[0] as [string, EmittedRecord];

      expect(pattern).toBe('archive.import.download');
      expect(record.data.importId).toBe((response.body as ImportIdEnvelope).result.data.importId);
      expect(record.data.dateHour).toBe('2026-08-11-0');
    });

    it('should return the claimed importId, not the supplied Idempotency-Key', async () => {
      const key = '22222222-2222-4222-8222-222222222222';

      const response = await request(httpServer)
        .post('/imports')
        .set('Idempotency-Key', key)
        .send({ dateHour: '2026-08-11-0' });

      expect(response.status).toBe(202);
      expect((response.body as ImportIdEnvelope).result.data.importId).toBe(
        '11111111-1111-4111-8111-111111111111',
      );
      expect((response.body as ImportIdEnvelope).result.data.importId).not.toBe(key);
      expect(serviceAClient.send).toHaveBeenCalledTimes(1);

      const [, record] = serviceAImportsClient.emit.mock.calls[0] as [string, EmittedRecord];

      expect(record.data.importId).toBe('11111111-1111-4111-8111-111111111111');
    });

    it('should still emit on a replayed key so a failed first publish can recover', async () => {
      const key = '22222222-2222-4222-8222-222222222222';

      for (let attempt = 0; attempt < 2; attempt += 1) {
        await request(httpServer)
          .post('/imports')
          .set('Idempotency-Key', key)
          .send({ dateHour: '2026-08-11-0' });
      }

      expect(serviceAImportsClient.emit).toHaveBeenCalledTimes(2);
      // Replay-safety itself (skipping a second real import) is enforced inside
      // service-a's DownloadImportController (Task 10) via the imports collection —
      // the gateway's only job is deterministic importId resolution, asserted above.
    });

    it('should not call the claim RPC when no Idempotency-Key is supplied', async () => {
      await request(httpServer).post('/imports').send({ dateHour: '2026-08-11-0' });

      expect(serviceAClient.send).not.toHaveBeenCalled();
      expect(serviceAImportsClient.emit).toHaveBeenCalledTimes(1);
    });

    it('should return 400 and not emit, when the Idempotency-Key is not a valid UUID', async () => {
      const response = await request(httpServer)
        .post('/imports')
        .set('Idempotency-Key', 'not-a-uuid')
        .send({ dateHour: '2026-08-11-0' });

      expect(response.status).toBe(400);
      expect(serviceAImportsClient.emit).not.toHaveBeenCalled();
    });

    it('should return 400 and not emit, when dateHour does not match the required format', async () => {
      const response = await request(httpServer)
        .post('/imports')
        .send({ dateHour: 'not-a-date-hour' });

      expect(response.status).toBe(400);
      expect(serviceAImportsClient.emit).not.toHaveBeenCalled();
    });

    it('should return 400 and not emit, when dateHour is missing', async () => {
      const response = await request(httpServer).post('/imports').send({});

      expect(response.status).toBe(400);
      expect(serviceAImportsClient.emit).not.toHaveBeenCalled();
    });

    it('should return 503 when the broker rejects the publish', async () => {
      const publishError = new Error('broker unavailable');
      serviceAImportsClient.emit.mockReturnValue(throwError(() => publishError));

      const response = await request(httpServer)
        .post('/imports')
        .send({ dateHour: '2026-08-11-0' });

      expect(response.status).toBe(503);
      expect((response.body as { status: string; code: number }).status).toBe('FAILED');
      expect((response.body as { status: string; code: number }).code).toBe(503);
    });

    it('should return 503, in the same error shape as a publish failure, when the claim RPC errors', async () => {
      const key = '22222222-2222-4222-8222-222222222222';
      const rpcError = new Error('service-a unreachable');
      serviceAClient.send.mockReturnValue(throwError(() => rpcError));

      const response = await request(httpServer)
        .post('/imports')
        .set('Idempotency-Key', key)
        .send({ dateHour: '2026-08-11-0' });

      expect(response.status).toBe(503);
      expect((response.body as { status: string; code: number }).status).toBe('FAILED');
      expect((response.body as { status: string; code: number }).code).toBe(503);
      expect(serviceAImportsClient.emit).not.toHaveBeenCalled();
    });

    it('should return 503, when the claim RPC times out', async () => {
      const key = '33333333-3333-4333-8333-333333333333';
      // Never emits, so the controller's timeout() operator fires a TimeoutError.
      serviceAClient.send.mockReturnValue(new Observable<never>());

      const response = await request(httpServer)
        .post('/imports')
        .set('Idempotency-Key', key)
        .send({ dateHour: '2026-08-11-0' });

      expect(response.status).toBe(503);
    });
  });
});
