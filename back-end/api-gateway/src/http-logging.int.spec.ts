import { type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { Test, type TestingModule } from '@nestjs/testing';
import { ResponseEnvelopeModule } from '@task1/shared/api-response/response-envelope.module';
import loggerConfig from '@task1/shared/config/logger.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/http/exception-handling.module';
import {
  REQUEST_COMPLETED_LOG,
  REQUEST_STARTED_LOG,
} from '@task1/shared/logger/http/http-logging.middleware';
import { LoggerModule } from '@task1/shared/logger/http/logger.module';
import { LoggerService } from '@task1/shared/logger/http/logger.service';
import { REDACT_CENSOR } from '@task1/shared/logger/redact-paths';
import { RequestContextModule } from '@task1/shared/request-context/http/request-context.module';
import { of } from 'rxjs';
import request from 'supertest';

import { AuthGuard } from './auth/auth.guard.js';
import { AuthModule } from './auth/auth.module.js';
import rabbitmqConfig from './config/rabbitmq.config.js';
import storageConfig from './config/storage.config.js';
import uploadConfig from './config/upload.config.js';
import { ContractModule } from './contract/contract.module.js';
import { ImportsModule } from './imports/imports.module.js';
import { SERVICE_A_RMQ_CLIENT } from './rmq/rmq-client.tokens.js';
import { RmqClientsModule } from './rmq/rmq-clients.module.js';

type App = Parameters<typeof request>[0];
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- local shape of one captured log call, not a domain interface.
type LoggedCall = {
  level: 'error' | 'info' | 'warn';
  fields: Record<string, unknown>;
  message: string;
};

const IMPORT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const CORRELATION_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

describe('HttpLoggingMiddleware (HTTP Integration)', () => {
  let app: INestApplication;
  let httpServer: App;
  let serviceAClient: { emit: ReturnType<typeof vi.fn> };
  let logged: LoggedCall[];

  function capture(level: LoggedCall['level']) {
    return vi.fn((fields: Record<string, unknown>, message: string) => {
      logged.push({ level, fields, message });
    });
  }

  function lineFor(message: string): LoggedCall {
    const line = logged.find((entry) => entry.message === message);

    if (line === undefined) {
      throw new Error(`no "${message}" line was logged`);
    }

    return line;
  }

  beforeAll(async () => {
    logged = [];
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
      .overrideProvider(SERVICE_A_RMQ_CLIENT)
      .useValue(serviceAClient as unknown as ClientProxy)
      .overrideProvider(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideProvider(LoggerService)
      .useValue({
        getLogger: () => ({
          info: capture('info'),
          warn: capture('warn'),
          error: capture('error'),
        }),
      })
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
    logged = [];
  });

  it('should return 202 and log both the start and the completion, when the payload is valid', async () => {
    const response = await request(httpServer)
      .post('/imports')
      .set('idempotency-key', IMPORT_ID)
      .send({ dateHour: '2026-08-11-0' });

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ result: { data: { importId: IMPORT_ID } } });

    await vi.waitFor(() => {
      expect(logged.map((entry) => entry.message)).toEqual([
        REQUEST_STARTED_LOG,
        REQUEST_COMPLETED_LOG,
      ]);
    });
  });

  it('should log the parsed body, query and headers, when the request starts', async () => {
    await request(httpServer)
      .post('/imports?dryRun=false')
      .set('idempotency-key', IMPORT_ID)
      .send({ dateHour: '2026-08-11-0' });

    expect(lineFor(REQUEST_STARTED_LOG).fields).toMatchObject({
      request: {
        method: 'POST',
        url: '/imports?dryRun=false',
        path: '/imports',
        query: { dryRun: 'false' },
        body: { dateHour: '2026-08-11-0' },
        headers: { 'idempotency-key': IMPORT_ID },
      },
    });
  });

  it('should censor the authorization header, when the request carries one', async () => {
    await request(httpServer)
      .post('/imports')
      .set('authorization', 'Bearer gha-1')
      .send({ dateHour: '2026-08-11-0' });

    const { request: loggedRequest } = lineFor(REQUEST_STARTED_LOG).fields as {
      request: { headers: unknown };
    };

    expect(loggedRequest.headers).toMatchObject({ authorization: REDACT_CENSOR });
  });

  it('should log both tracing ids matching the response headers, when the request completes', async () => {
    const response = await request(httpServer)
      .post('/imports')
      .set('x-correlation-id', CORRELATION_ID)
      .send({ dateHour: '2026-08-11-0' });

    await vi.waitFor(() => {
      expect(lineFor(REQUEST_COMPLETED_LOG).fields).toMatchObject({
        correlationId: CORRELATION_ID,
        requestId: response.headers['x-request-id'],
        method: 'POST',
        url: '/imports',
        statusCode: 202,
      });
    });
  });

  it('should log the completion at info level with a duration, when the request succeeds', async () => {
    await request(httpServer).post('/imports').send({ dateHour: '2026-08-11-0' });

    await vi.waitFor(() => {
      const completion = lineFor(REQUEST_COMPLETED_LOG);

      expect(completion.level).toBe('info');
      expect(completion.fields.durationMs).toEqual(expect.any(Number));
    });
  });

  it('should return 400 and log the completion at warn level, when the payload is invalid', async () => {
    const response = await request(httpServer).post('/imports').send({ dateHour: 'not-an-hour' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      status: 'FAILED',
      code: 400,
      reason: 'REQUEST_CONTRACT_VIOLATION',
    });

    await vi.waitFor(() => {
      expect(lineFor(REQUEST_COMPLETED_LOG)).toMatchObject({
        level: 'warn',
        fields: { statusCode: 400 },
      });
    });
  });

  it('should return 404 and log the completion at warn level, when the route does not exist', async () => {
    const response = await request(httpServer).get('/does-not-exist');

    expect(response.status).toBe(404);

    await vi.waitFor(() => {
      expect(lineFor(REQUEST_COMPLETED_LOG)).toMatchObject({
        level: 'warn',
        fields: { statusCode: 404 },
      });
    });
  });
});
