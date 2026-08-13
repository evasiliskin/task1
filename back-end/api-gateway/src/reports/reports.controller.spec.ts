import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type ConfigType } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { type LoggerService } from '@task1/shared/logger/http/logger.service';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { type Response } from 'express';
import { of } from 'rxjs';

import type rabbitmqConfig from '../config/rabbitmq.config.js';

import { type GetReportQueryDto } from './dto/get-report-query.dto.js';
import { ReportsController } from './reports.controller.js';

function buildController(
  sendMock: ReturnType<typeof vi.fn>,
  loggerMocks: { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> },
  requestContextService: RequestContextService,
): ReportsController {
  const serviceBClient = { send: sendMock } as unknown as ClientProxy;
  const rabbitmqConfiguration = {
    rpcTimeoutMs: 10_000,
  } as unknown as ConfigType<typeof rabbitmqConfig>;
  const loggerService = {
    getLogger: vi.fn().mockReturnValue({
      warn: loggerMocks.warn,
      error: loggerMocks.error,
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
    } satisfies Partial<AppLogger>),
  } as unknown as LoggerService;

  return new ReportsController(
    serviceBClient,
    requestContextService,
    rabbitmqConfiguration,
    loggerService,
  );
}

function buildFakeResponse(): Response {
  return new EventEmitter() as unknown as Response;
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 20);
  });
}

describe('ReportsController', () => {
  let reportDirectory: string;
  let requestContextService: RequestContextService;

  beforeEach(() => {
    reportDirectory = mkdtempSync(join(tmpdir(), 'reports-controller-spec-'));
    requestContextService = new RequestContextService();
  });

  afterEach(() => {
    rmSync(reportDirectory, { recursive: true, force: true });
  });

  describe('getPdfReport', () => {
    const query: GetReportQueryDto = { importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' };

    it('should delete the report file, when the response closes after finishing normally', async () => {
      const reportPath = join(reportDirectory, 'report.pdf');
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- test fixture inside a temp directory this spec owns.
      writeFileSync(reportPath, '%PDF-1.4 fake report body');
      const sendMock = vi.fn().mockReturnValue(of({ reportPath }));
      const warn = vi.fn();
      const error = vi.fn();
      const controller = buildController(sendMock, { warn, error }, requestContextService);
      const response = buildFakeResponse();

      await requestContextService.run(
        { correlationId: 'correlation-id', requestId: 'request-id' },
        () => controller.getPdfReport(query, response),
      );
      response.emit('finish');
      response.emit('close');
      await flushMicrotasks();

      // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
      expect(existsSync(reportPath)).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    });

    it('should delete the report file, when the response closes without ever finishing (aborted download)', async () => {
      const reportPath = join(reportDirectory, 'report.pdf');
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
      writeFileSync(reportPath, '%PDF-1.4 fake report body');
      const sendMock = vi.fn().mockReturnValue(of({ reportPath }));
      const warn = vi.fn();
      const error = vi.fn();
      const controller = buildController(sendMock, { warn, error }, requestContextService);
      const response = buildFakeResponse();

      await requestContextService.run(
        { correlationId: 'correlation-id', requestId: 'request-id' },
        () => controller.getPdfReport(query, response),
      );
      response.emit('close');
      await flushMicrotasks();

      // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
      expect(existsSync(reportPath)).toBe(false);
    });

    it('should delete the report file only once, when the response emits close twice', async () => {
      const reportPath = join(reportDirectory, 'report.pdf');
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
      writeFileSync(reportPath, '%PDF-1.4 fake report body');
      const sendMock = vi.fn().mockReturnValue(of({ reportPath }));
      const warn = vi.fn();
      const error = vi.fn();
      const controller = buildController(sendMock, { warn, error }, requestContextService);
      const response = buildFakeResponse();

      await requestContextService.run(
        { correlationId: 'correlation-id', requestId: 'request-id' },
        () => controller.getPdfReport(query, response),
      );
      response.emit('close');
      await flushMicrotasks();
      response.emit('close');
      await flushMicrotasks();

      expect(warn).not.toHaveBeenCalled();
    });

    it('should log a warning and not throw, when deleting the report file fails', async () => {
      const reportPath = join(reportDirectory, 'missing-report.pdf');
      const sendMock = vi.fn().mockReturnValue(of({ reportPath }));
      const warn = vi.fn();
      const error = vi.fn();
      const controller = buildController(sendMock, { warn, error }, requestContextService);
      const response = buildFakeResponse();

      await requestContextService.run(
        { correlationId: 'correlation-id', requestId: 'request-id' },
        () => controller.getPdfReport(query, response),
      );
      response.emit('close');
      await flushMicrotasks();

      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ reportPath }),
        'failed to delete generated PDF report file',
      );
    });

    it('should log an error and still delete the report file, when the report file cannot be read', async () => {
      const reportPath = join(reportDirectory, 'does-not-exist.pdf');
      const sendMock = vi.fn().mockReturnValue(of({ reportPath }));
      const warn = vi.fn();
      const error = vi.fn();
      const controller = buildController(sendMock, { warn, error }, requestContextService);
      const response = buildFakeResponse();

      await requestContextService.run(
        { correlationId: 'correlation-id', requestId: 'request-id' },
        () => controller.getPdfReport(query, response),
      );
      await flushMicrotasks();

      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ reportPath }),
        'failed to stream generated PDF report file',
      );
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ reportPath }),
        'failed to delete generated PDF report file',
      );
    });
  });
});
