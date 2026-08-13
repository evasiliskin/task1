import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { Test, type TestingModule } from '@nestjs/testing';
import loggerConfig from '@task1/shared/config/logger.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/http/exception-handling.module';
import { RequestContextModule } from '@task1/shared/request-context/http/request-context.module';
import { of } from 'rxjs';
import request from 'supertest';

import { AuthGuard } from '../auth/auth.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import rabbitmqConfig from '../config/rabbitmq.config.js';

import { SERVICE_B_RMQ_CLIENT } from './rabbitmq-client.token.js';
import { ReportsModule } from './reports.module.js';

type App = Parameters<typeof request>[0];

describe('ReportsController (HTTP Integration)', () => {
  let app: INestApplication;
  let httpServer: App;
  let serviceBClient: { send: ReturnType<typeof vi.fn> };
  let reportDirectory: string;
  let reportPath: string;

  beforeAll(async () => {
    reportDirectory = mkdtempSync(join(tmpdir(), 'reports-controller-spec-'));
    serviceBClient = { send: vi.fn() };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [rabbitmqConfig, loggerConfig],
        }),
        RequestContextModule,
        ExceptionHandlingModule,
        AuthModule,
        ReportsModule,
      ],
    })
      .overrideProvider(SERVICE_B_RMQ_CLIENT)
      .useValue(serviceBClient as unknown as ClientProxy)
      .overrideProvider(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    httpServer = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
    rmSync(reportDirectory, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    reportPath = join(reportDirectory, 'report.pdf');
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    writeFileSync(reportPath, '%PDF-1.4 fake report body');
  });

  describe('GET /reports/pdf', () => {
    const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

    it('should return 200 with application/pdf content type, when the report is generated', async () => {
      serviceBClient.send.mockReturnValue(of({ reportPath }));

      const response = await request(httpServer).get('/reports/pdf').query({ importId });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/pdf');
      expect(response.headers['content-disposition']).toContain('attachment');
    });

    it('should forward importId inside the RMQ message, when provided', async () => {
      serviceBClient.send.mockReturnValue(of({ reportPath }));

      await request(httpServer).get('/reports/pdf').query({ importId });

      const [pattern, record] = serviceBClient.send.mock.calls[0] as [
        string,
        { data: { importId: string } },
      ];
      expect(pattern).toBe('reports.pdf.generate');
      expect(record.data).toEqual({ importId });
    });

    it('should delete the report file after the response finishes, when the download completes', async () => {
      serviceBClient.send.mockReturnValue(of({ reportPath }));

      await request(httpServer).get('/reports/pdf').query({ importId });
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });

      // eslint-disable-next-line security/detect-non-literal-fs-filename
      expect(existsSync(reportPath)).toBe(false);
    });

    it('should return 400 and not call service-b, when importId is not a uuid', async () => {
      const response = await request(httpServer)
        .get('/reports/pdf')
        .query({ importId: 'not-a-uuid' });

      expect(response.status).toBe(400);
      expect(serviceBClient.send).not.toHaveBeenCalled();
    });
  });
});
