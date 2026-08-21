import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
import reportConfig from '../config/report.config.js';
import { ContractModule } from '../contract/contract.module.js';
import { SERVICE_B_RMQ_CLIENT } from '../rmq/rmq-client.tokens.js';
import { RmqClientsModule } from '../rmq/rmq-clients.module.js';

import { ReportsModule } from './reports.module.js';

type App = Parameters<typeof request>[0];

const REPORT_BODY = '%PDF-1.4 fake report body';

describe('ReportsController (HTTP Integration)', () => {
  let app: INestApplication;
  let httpServer: App;
  let serviceBClient: { send: ReturnType<typeof vi.fn> };
  let reportDirectory: string;
  let reportPath: string;
  const originalReportDirectoryEnvironment = process.env.REPORT_DIR;

  beforeAll(async () => {
    reportDirectory = mkdtempSync(join(tmpdir(), 'reports-controller-spec-'));
    process.env.REPORT_DIR = reportDirectory;
    serviceBClient = { send: vi.fn() };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [rabbitmqConfig, loggerConfig, reportConfig],
        }),
        RequestContextModule,
        ExceptionHandlingModule,
        ResponseEnvelopeModule,
        AuthModule,
        ContractModule,
        RmqClientsModule,
        ReportsModule,
      ],
    })
      .overrideProvider(SERVICE_B_RMQ_CLIENT)
      .useValue(serviceBClient as unknown as ClientProxy)
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
    rmSync(reportDirectory, { recursive: true, force: true });
    process.env.REPORT_DIR = originalReportDirectoryEnvironment;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    reportPath = join(reportDirectory, 'report.pdf');
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    writeFileSync(reportPath, REPORT_BODY);
  });

  describe('GET /reports/pdf', () => {
    const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

    it('should return 200 with the generated PDF body, when the report is generated', async () => {
      serviceBClient.send.mockReturnValue(of({ reportPath }));

      const response = await request(httpServer).get('/reports/pdf').query({ importId });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/pdf');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect((response.body as Buffer).toString('utf8')).toBe(REPORT_BODY);
    });

    it('should stream the pdf unenveloped, when the report exists', async () => {
      serviceBClient.send.mockReturnValue(of({ reportPath }));

      const response = await request(httpServer).get('/reports/pdf').query({ importId });

      expect(response.status).toBe(200);
      expect(response.body).toBeInstanceOf(Buffer);
      expect((response.body as Buffer).toString()).not.toContain('SUCCESS');
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

    it('should not delete the report file after the response finishes, when the download completes', async () => {
      serviceBClient.send.mockReturnValue(of({ reportPath }));

      await request(httpServer).get('/reports/pdf').query({ importId });
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });

      // eslint-disable-next-line security/detect-non-literal-fs-filename
      expect(existsSync(reportPath)).toBe(true);
    });

    it('should return 400 and not call service-b, when importId is not a uuid', async () => {
      const response = await request(httpServer)
        .get('/reports/pdf')
        .query({ importId: 'not-a-uuid' });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        status: 'FAILED',
        code: 400,
        reason: 'REQUEST_CONTRACT_VIOLATION',
      });
      expect(serviceBClient.send).not.toHaveBeenCalled();
    });

    it('should return 500 and not delete the file, when the reportPath is outside the configured report directory', async () => {
      const outsideDirectory = mkdtempSync(join(tmpdir(), 'reports-controller-outside-'));
      const outsideReportPath = join(outsideDirectory, 'report.pdf');
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      writeFileSync(outsideReportPath, REPORT_BODY);
      serviceBClient.send.mockReturnValue(of({ reportPath: outsideReportPath }));

      try {
        const response = await request(httpServer).get('/reports/pdf').query({ importId });

        expect(response.status).toBe(500);
        expect(response.body).toMatchObject({ status: 'FAILED', code: 500 });
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        expect(existsSync(outsideReportPath)).toBe(true);
      } finally {
        rmSync(outsideDirectory, { recursive: true, force: true });
      }
    });
  });
});
