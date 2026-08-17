import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { type rename as renameType } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { type INestApplication } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { type ClientProxy } from '@nestjs/microservices';
import { Test, type TestingModule } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ResponseEnvelopeModule } from '@task1/shared/api-response/response-envelope.module';
import loggerConfig from '@task1/shared/config/logger.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/http/exception-handling.module';
import { LoggerService } from '@task1/shared/logger/logger.service';
import { RequestContextModule } from '@task1/shared/request-context/http/request-context.module';
import { Redis } from 'ioredis';
import { Observable, of, throwError } from 'rxjs';
import request from 'supertest';

import { AuthGuard } from '../auth/auth.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import rabbitmqConfig from '../config/rabbitmq.config.js';
import storageConfig from '../config/storage.config.js';
import throttleConfig from '../config/throttle.config.js';
import uploadConfig from '../config/upload.config.js';
import { ContractModule } from '../contract/contract.module.js';
import { SERVICE_A_IMPORTS_RMQ_CLIENT } from '../rmq/rmq-client.tokens.js';
import { RmqClientsModule } from '../rmq/rmq-clients.module.js';

import { ImportsModule } from './imports.module.js';

const renameMock = vi.fn();

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('node:fs/promises');
  const actualRename = actual.rename as typeof renameType;

  return {
    ...actual,
    rename: (...args: Parameters<typeof actualRename>) => {
      renameMock(...args);

      return actualRename(...args);
    },
  };
});

type App = Parameters<typeof request>[0];
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- deliberately a `type`, not an `I`-prefixed `interface`: this is a local destructuring shape for the mocked emit() call's RmqRecord, not a domain interface.
type EmittedRecord = { data: { importId: string; filePath: string } };
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- local destructuring shape for the enveloped response body, not a domain interface.
type ImportIdEnvelope = { result: { data: { importId: string } } };

describe('UploadImportController (HTTP Integration)', () => {
  let app: INestApplication;
  let httpServer: App;
  let storageDirectory: string;
  let serviceAClient: { emit: ReturnType<typeof vi.fn> };
  let loggerSpy: {
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    isLevelEnabled: ReturnType<typeof vi.fn>;
  };

  beforeAll(async () => {
    storageDirectory = mkdtempSync(join(tmpdir(), 'upload-import-spec-'));
    process.env.STORAGE_DIR = storageDirectory;
    process.env.RABBITMQ_RPC_TIMEOUT_MS = '50';

    serviceAClient = { emit: vi.fn(() => of(undefined)) };
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
    rmSync(storageDirectory, { recursive: true, force: true });
    delete process.env.STORAGE_DIR;
    delete process.env.RABBITMQ_RPC_TIMEOUT_MS;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    serviceAClient.emit.mockReturnValue(of(undefined));
  });

  describe('POST /imports/upload', () => {
    it('should return 201 with importId, persist the file, and emit the process message, when a valid .json.gz file is uploaded', async () => {
      const gzip = gzipSync(Buffer.from('gzipped-content'));

      const response = await request(httpServer)
        .post('/imports/upload')
        .attach('file', gzip, 'archive.json.gz');

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ status: 'SUCCESS', code: 201, message: 'OK' });
      expect(typeof (response.body as ImportIdEnvelope).result.data.importId).toBe('string');
      expect(serviceAClient.emit).toHaveBeenCalledTimes(1);

      const [pattern, record] = serviceAClient.emit.mock.calls[0] as [string, EmittedRecord];

      expect(pattern).toBe('archive.process.upload');
      expect(record.data.importId).toBe((response.body as ImportIdEnvelope).result.data.importId);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- record.data.filePath is read back from this test's own mocked emit call for assertion, not external input.
      expect(readFileSync(record.data.filePath)).toEqual(gzip);
    });

    it('should return 400 and not emit any message, when the uploaded file does not have a .json.gz extension', async () => {
      const response = await request(httpServer)
        .post('/imports/upload')
        .attach('file', Buffer.from('not gzip'), 'archive.txt');

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ status: 'FAILED', code: 400 });
      expect(serviceAClient.emit).not.toHaveBeenCalled();
    });

    it('should return 400 and not emit any message, when no file is provided', async () => {
      const response = await request(httpServer).post('/imports/upload');

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ status: 'FAILED', code: 400 });
      expect(serviceAClient.emit).not.toHaveBeenCalled();
    });

    it('should return 400 and write nothing to storage, when the filename is not an archive', async () => {
      const response = await request(httpServer)
        .post('/imports/upload')
        .attach('file', Buffer.from('hello'), 'notes.txt');

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ status: 'FAILED', code: 400 });
      expect(renameMock).not.toHaveBeenCalled();
    });

    it('should return 400 and remove the temp file, when a .json.gz file is not gzip-encoded', async () => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- storageDirectory is this spec's own mkdtempSync'd fixture directory, never external input.
      const filesBefore = readdirSync(storageDirectory).length;

      const response = await request(httpServer)
        .post('/imports/upload')
        .attach('file', Buffer.from('not gzip at all'), 'archive.json.gz');

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ status: 'FAILED', code: 400 });
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox directory, not external input.
      expect(readdirSync(storageDirectory)).toHaveLength(filesBefore);
    });

    it('should return 201 and the claimed importId, when the upload is a well-formed gzip archive', async () => {
      const gzip = gzipSync(Buffer.from('{"id":"1"}\n'));

      const response = await request(httpServer)
        .post('/imports/upload')
        .attach('file', gzip, 'archive.json.gz');

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        status: 'SUCCESS',
        code: 201,
        result: { data: { importId: expect.any(String) as string } },
      });
    });

    it('should return 503, when the broker rejects the publish', async () => {
      const publishError = new Error('broker unavailable');
      serviceAClient.emit.mockReturnValue(throwError(() => publishError));

      const response = await request(httpServer)
        .post('/imports/upload')
        .attach('file', gzipSync(Buffer.from('gz-bytes')), 'archive.json.gz');

      expect(response.status).toBe(503);
      expect((response.body as { status: string; code: number }).status).toBe('FAILED');
      expect((response.body as { status: string; code: number }).code).toBe(503);
    });

    it('should return 504 instead of hanging, when the broker never confirms the publish', async () => {
      serviceAClient.emit.mockReturnValue(new Observable<never>());

      const response = await request(httpServer)
        .post('/imports/upload')
        .attach('file', gzipSync(Buffer.from('gz-bytes')), 'archive.json.gz');

      expect(response.status).toBe(504);
      expect(response.body).toMatchObject({ status: 'FAILED', code: 504 });
    });

    it('should rename the upload into the configured storage directory, when the upload succeeds', async () => {
      const overrideDirectory = mkdtempSync(join(tmpdir(), 'upload-import-override-'));
      const gzip = gzipSync(Buffer.from('gzipped-content'));

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
        .overrideProvider(storageConfig.KEY)
        .useValue({
          dir: overrideDirectory,
          uploadRetentionMs: 86_400_000,
          uploadSweepIntervalMs: 900_000,
        })
        .overrideProvider(SERVICE_A_IMPORTS_RMQ_CLIENT)
        .useValue(serviceAClient as unknown as ClientProxy)
        .overrideProvider(AuthGuard)
        .useValue({ canActivate: () => true })
        .overrideProvider(LoggerService)
        .useValue({ getLogger: () => loggerSpy })
        .compile();

      const overrideApp: INestApplication = moduleFixture.createNestApplication();
      await overrideApp.init();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const overrideHttpServer: App = overrideApp.getHttpServer();

      try {
        const response = await request(overrideHttpServer)
          .post('/imports/upload')
          .attach('file', gzip, 'archive.json.gz');

        expect(response.status).toBe(201);
        expect(response.body).toMatchObject({ status: 'SUCCESS', code: 201 });

        const [, to] = renameMock.mock.calls[renameMock.mock.calls.length - 1] as [string, string];
        expect(to).toContain(overrideDirectory);
      } finally {
        await overrideApp.close();
        rmSync(overrideDirectory, { recursive: true, force: true });
      }
    });
  });
});

function createFakeRedisClient(): Redis {
  const hits = new Map<string, { count: number; expiresAt: number }>();
  const blocks = new Map<string, number>();

  const call = (
    _command: string,
    _script: string,
    _numKeys: number,
    hitKey: string,
    blockKey: string,
    _throttlerName: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): Promise<[number, number, number, number]> => {
    const now = Date.now();

    let hit = hits.get(hitKey);

    if (hit === undefined || hit.expiresAt <= now) {
      hit = { count: 0, expiresAt: 0 };
    }
    hit.count += 1;
    let timeToExpire = hit.expiresAt - now;

    if (timeToExpire <= 0) {
      hit.expiresAt = now + ttl;
      timeToExpire = ttl;
    }
    hits.set(hitKey, hit);

    const blockExpiresAt = blocks.get(blockKey);
    let isBlocked = blockExpiresAt !== undefined && blockExpiresAt > now;
    let timeToBlockExpire = 0;

    if (isBlocked) {
      timeToBlockExpire = blockExpiresAt! - now;
    } else if (hit.count > limit) {
      blocks.set(blockKey, now + blockDuration);
      isBlocked = true;
      timeToBlockExpire = blockDuration;
    }

    if (isBlocked && timeToBlockExpire <= 0) {
      blocks.delete(blockKey);
      hit.count = 1;
      hit.expiresAt = now + ttl;
      timeToExpire = ttl;
      isBlocked = false;
    }

    return Promise.resolve([hit.count, timeToExpire, isBlocked ? 1 : 0, timeToBlockExpire]);
  };

  const client = new Redis({ lazyConnect: true });

  // eslint-disable-next-line @typescript-eslint/no-empty-function -- deliberately swallowed; test double never connects.
  client.on('error', () => {});
  client.call = call as unknown as Redis['call'];

  return client;
}

describe('UploadImportController rate limiting (HTTP Integration)', () => {
  let app: INestApplication;
  let httpServer: App;
  let storageDirectory: string;

  beforeAll(async () => {
    storageDirectory = mkdtempSync(join(tmpdir(), 'upload-import-throttle-spec-'));
    process.env.STORAGE_DIR = storageDirectory;

    const serviceAClient = { emit: vi.fn(() => of(undefined)) };
    const loggerSpy = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      isLevelEnabled: vi.fn(() => false),
    };
    const fakeRedisClient = createFakeRedisClient();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [storageConfig, uploadConfig, rabbitmqConfig, loggerConfig, throttleConfig],
        }),
        RequestContextModule,
        ExceptionHandlingModule,
        ResponseEnvelopeModule,
        AuthModule,
        ContractModule,
        RmqClientsModule,
        ImportsModule,
        ThrottlerModule.forRootAsync({
          inject: [throttleConfig.KEY],
          useFactory: (config: ConfigType<typeof throttleConfig>) => ({
            throttlers: [{ ttl: config.ttlMs, limit: config.limit }],
            storage: new ThrottlerStorageRedisService(fakeRedisClient),
          }),
        }),
      ],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    })
      .overrideProvider(SERVICE_A_IMPORTS_RMQ_CLIENT)
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
    rmSync(storageDirectory, { recursive: true, force: true });
    delete process.env.STORAGE_DIR;
  });

  it('should return 429 without reaching the handler, when the per-minute upload quota is exhausted', async () => {
    const gzip = gzipSync(Buffer.from('{}\n'));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(httpServer)
        .post('/imports/upload')
        .attach('file', gzip, 'a.json.gz')
        .expect(201);
    }

    const response = await request(httpServer)
      .post('/imports/upload')
      .attach('file', gzip, 'a.json.gz');

    expect(response.status).toBe(429);
    expect(response.body).toMatchObject({ status: 'FAILED', code: 429 });
  });
});
