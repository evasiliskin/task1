import { HttpStatus, type INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
import { applyRequestContext } from './request-context.setup.js';
import { SERVICE_A_IMPORTS_RMQ_CLIENT } from './rmq/rmq-client.tokens.js';
import { RmqClientsModule } from './rmq/rmq-clients.module.js';

type App = Parameters<typeof request>[0];

const CORRELATION_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

describe('Request context production wiring (HTTP Integration)', () => {
  let app: INestApplication;
  let httpServer: App;
  let serviceAClient: { emit: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    serviceAClient = { emit: vi.fn(() => of(undefined)) };

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
      .useValue(serviceAClient)
      .overrideProvider(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    // bodyParser: false mirrors main.ts — the parser is mounted by applyRequestContext, after the
    // context middleware, which is the whole point of this test: it exercises both the
    // adapter-level mount and LoggerModule's module-level RequestContextMiddleware together, the
    // way production actually wires them.
    app = moduleFixture.createNestApplication({ bodyParser: false });
    applyRequestContext(app);
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    httpServer = app.getHttpServer() as App;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return one correlation id and use that same id on the outbound RMQ message', async () => {
    const response = await request(httpServer)
      .post('/api/v1/imports')
      .send({ dateHour: '2024-01-01-0' })
      .expect(HttpStatus.ACCEPTED);

    // eslint-disable-next-line security/detect-object-injection -- CORRELATION_ID_HEADER is a fixed constant, not user input
    const echoed = response.headers[CORRELATION_ID_HEADER];

    expect(echoed).toBeDefined();
    // The envelope carries it at meta.tracing.correlationId — see `buildSuccessEnvelope`.
    expect(response.body).toMatchObject({ meta: { tracing: { correlationId: echoed } } });

    const [, record] = serviceAClient.emit.mock.calls[0] as [string, unknown];
    const { options } = record as { options: { headers: Record<string, string> } };

    // eslint-disable-next-line security/detect-object-injection -- CORRELATION_ID_HEADER is a fixed constant, not user input
    expect(options.headers[CORRELATION_ID_HEADER]).toBe(echoed);
  });

  it('should adopt a client-supplied correlation id end to end', async () => {
    const response = await request(httpServer)
      .post('/api/v1/imports')
      .set(CORRELATION_ID_HEADER, CORRELATION_ID)
      .send({ dateHour: '2024-01-01-0' })
      .expect(HttpStatus.ACCEPTED);

    // eslint-disable-next-line security/detect-object-injection -- CORRELATION_ID_HEADER is a fixed constant, not user input
    expect(response.headers[CORRELATION_ID_HEADER]).toBe(CORRELATION_ID);

    const [, record] = serviceAClient.emit.mock.calls[0] as [string, unknown];
    const { options } = record as { options: { headers: Record<string, string> } };

    // eslint-disable-next-line security/detect-object-injection -- CORRELATION_ID_HEADER is a fixed constant, not user input
    expect(options.headers[CORRELATION_ID_HEADER]).toBe(CORRELATION_ID);
  });
});
