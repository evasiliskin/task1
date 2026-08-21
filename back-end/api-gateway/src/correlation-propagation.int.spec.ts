import { type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { Test, type TestingModule } from '@nestjs/testing';
import { ResponseEnvelopeModule } from '@task1/shared/api-response/response-envelope.module';
import loggerConfig from '@task1/shared/config/logger.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/http/exception-handling.module';
import { LoggerModule } from '@task1/shared/logger/http/logger.module';
import { RequestContextModule } from '@task1/shared/request-context/http/request-context.module';
import { CORRELATION_ID_HEADER } from '@task1/shared/request-context/request-context.types';
import { of } from 'rxjs';
import request from 'supertest';

import { AuthGuard } from './auth/auth.guard.js';
import { AuthModule } from './auth/auth.module.js';
import rabbitmqConfig from './config/rabbitmq.config.js';
import storageConfig from './config/storage.config.js';
import uploadConfig from './config/upload.config.js';
import { ContractModule } from './contract/contract.module.js';
import { ImportsModule } from './imports/imports.module.js';
import { SERVICE_A_IMPORTS_RMQ_CLIENT, SERVICE_A_RMQ_CLIENT } from './rmq/rmq-client.tokens.js';
import { RmqClientsModule } from './rmq/rmq-clients.module.js';

type App = Parameters<typeof request>[0];

const CORRELATION_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const IMPORT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

describe('Correlation propagation (HTTP Integration)', () => {
  let app: INestApplication;
  let httpServer: App;
  let serviceAImportsClient: { emit: ReturnType<typeof vi.fn> };
  let serviceAClient: { send: ReturnType<typeof vi.fn> };

  function emittedHeaders(): Record<string, string> {
    const [, record] = serviceAImportsClient.emit.mock.calls[0] as [string, unknown];
    const { options } = record as { options: { headers: Record<string, string> } };

    return options.headers;
  }

  beforeAll(async () => {
    serviceAImportsClient = { emit: vi.fn(() => of(undefined)) };
    serviceAClient = { send: vi.fn(() => of({ importId: IMPORT_ID })) };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [storageConfig, uploadConfig, rabbitmqConfig, loggerConfig],
        }),
        RequestContextModule,
        LoggerModule,
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
    serviceAImportsClient.emit.mockClear();
    serviceAClient.send.mockClear();
    serviceAClient.send.mockReturnValue(of({ importId: IMPORT_ID }));
  });

  it('should forward the inbound correlation id onto the published message, when triggering an import', async () => {
    await request(httpServer)
      .post('/imports')
      .set(CORRELATION_ID_HEADER, CORRELATION_ID)
      .set('idempotency-key', IMPORT_ID)
      .send({ dateHour: '2026-08-11-0' })
      .expect(202);

    expect(serviceAImportsClient.emit).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line security/detect-object-injection -- CORRELATION_ID_HEADER is a fixed constant, not user input
    expect(emittedHeaders()[CORRELATION_ID_HEADER]).toBe(CORRELATION_ID);
  });

  it('should echo the same correlation id on the response, when triggering an import', async () => {
    const response = await request(httpServer)
      .post('/imports')
      .set(CORRELATION_ID_HEADER, CORRELATION_ID)
      .set('idempotency-key', IMPORT_ID)
      .send({ dateHour: '2026-08-11-0' });

    // eslint-disable-next-line security/detect-object-injection -- CORRELATION_ID_HEADER is a fixed constant, not user input
    expect(response.headers[CORRELATION_ID_HEADER]).toBe(CORRELATION_ID);
    // eslint-disable-next-line security/detect-object-injection -- CORRELATION_ID_HEADER is a fixed constant, not user input
    expect(emittedHeaders()[CORRELATION_ID_HEADER]).toBe(response.headers[CORRELATION_ID_HEADER]);
  });

  it('should generate and propagate one correlation id, when the client supplies none', async () => {
    const response = await request(httpServer)
      .post('/imports')
      .set('idempotency-key', IMPORT_ID)
      .send({ dateHour: '2026-08-11-0' });

    // eslint-disable-next-line security/detect-object-injection -- CORRELATION_ID_HEADER is a fixed constant, not user input
    const generated = response.headers[CORRELATION_ID_HEADER];

    expect(generated).toBeDefined();
    // eslint-disable-next-line security/detect-object-injection -- CORRELATION_ID_HEADER is a fixed constant, not user input
    expect(emittedHeaders()[CORRELATION_ID_HEADER]).toBe(generated);
  });
});
