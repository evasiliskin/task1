import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { Test, type TestingModule } from '@nestjs/testing';
import loggerConfig from '@task1/shared/config/logger.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/http/exception-handling.module';
import { RequestContextModule } from '@task1/shared/request-context/http/request-context.module';
import request from 'supertest';

import { AuthGuard } from '../auth/auth.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import rabbitmqConfig from '../config/rabbitmq.config.js';
import storageConfig from '../config/storage.config.js';
import uploadConfig from '../config/upload.config.js';

import { ImportsModule } from './imports.module.js';
import { SERVICE_A_RMQ_CLIENT } from './rabbitmq-client.token.js';

type App = Parameters<typeof request>[0];
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- deliberately a `type`, not an `I`-prefixed `interface`: this is a local destructuring shape for the mocked emit() call, not a domain interface.
type EmittedMessage = { importId: string; filePath: string };

describe('UploadImportController (HTTP Integration)', () => {
  let app: INestApplication;
  let httpServer: App;
  let storageDirectory: string;
  let serviceAClient: { emit: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    storageDirectory = mkdtempSync(join(tmpdir(), 'upload-import-spec-'));
    process.env.STORAGE_DIR = storageDirectory;

    serviceAClient = { emit: vi.fn() };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [storageConfig, uploadConfig, rabbitmqConfig, loggerConfig],
        }),
        RequestContextModule,
        ExceptionHandlingModule,
        AuthModule,
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
    rmSync(storageDirectory, { recursive: true, force: true });
    delete process.env.STORAGE_DIR;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /imports/upload', () => {
    it('should return 201 with importId, persist the file, and emit the process message, when a valid .json.gz file is uploaded', async () => {
      const response = await request(httpServer)
        .post('/imports/upload')
        .attach('file', Buffer.from('gzipped-content'), 'archive.json.gz');

      expect(response.status).toBe(201);
      expect(typeof (response.body as { importId: string }).importId).toBe('string');
      expect(serviceAClient.emit).toHaveBeenCalledTimes(1);

      const [pattern, payload] = serviceAClient.emit.mock.calls[0] as [string, EmittedMessage];

      expect(pattern).toBe('archive.process.upload');
      expect(payload.importId).toBe((response.body as { importId: string }).importId);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- payload.filePath is read back from this test's own mocked emit call for assertion, not external input.
      expect(readFileSync(payload.filePath, 'utf8')).toBe('gzipped-content');
    });

    it('should return 400 and not emit any message, when the uploaded file does not have a .json.gz extension', async () => {
      const response = await request(httpServer)
        .post('/imports/upload')
        .attach('file', Buffer.from('not gzip'), 'archive.txt');

      expect(response.status).toBe(400);
      expect(serviceAClient.emit).not.toHaveBeenCalled();
    });

    it('should return 400 and not emit any message, when no file is provided', async () => {
      const response = await request(httpServer).post('/imports/upload');

      expect(response.status).toBe(400);
      expect(serviceAClient.emit).not.toHaveBeenCalled();
    });
  });
});
