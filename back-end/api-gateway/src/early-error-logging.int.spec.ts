import { type INestApplication } from '@nestjs/common';
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

describe('Early-failure correlation (HTTP Integration)', () => {
  let app: INestApplication;
  let httpServer: App;

  beforeAll(async () => {
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
      .useValue({ emit: vi.fn(() => of(undefined)) })
      .overrideProvider(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    applyRequestContext(app);
    await app.init();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    httpServer = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should echo the inbound correlation id, when the body fails to parse', async () => {
    const response = await request(httpServer)
      .post('/imports')
      .set(CORRELATION_ID_HEADER, CORRELATION_ID)
      .set('content-type', 'application/json')
      .send('{ not json');

    expect(response.status).toBe(400);
    // eslint-disable-next-line security/detect-object-injection -- CORRELATION_ID_HEADER is a fixed constant, not user input
    expect(response.headers[CORRELATION_ID_HEADER]).toBe(CORRELATION_ID);
    expect(response.body).toMatchObject({ meta: { tracing: { correlationId: CORRELATION_ID } } });
  });
});
