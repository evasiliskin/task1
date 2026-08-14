import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type ConfigType } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { type LoggerService } from '@task1/shared/logger/http/logger.service';
import { type LogFields } from '@task1/shared/logger/types';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { type Response } from 'express';
import { of } from 'rxjs';

import type rabbitmqConfig from '../config/rabbitmq.config.js';
import { type ReportConfiguration } from '../config/report.config.js';
import { type BoundRequest } from '../contract/decorators/model-binder.decorator.js';

import { ReportPathOutsideConfiguredDirectoryError } from './errors.js';
import { ReportsController } from './reports.controller.js';
import { type GetReportRequestSchema } from './schemas/get-report-request.schema.js';

type LogMock = ReturnType<
  typeof vi.fn<(fields: LogFields, message: string, error?: unknown) => void>
>;

function buildController(
  sendMock: ReturnType<typeof vi.fn>,
  loggerMocks: { warn: LogMock; error: LogMock },
  requestContextService: RequestContextService,
  reportDirectory: string,
): ReportsController {
  const serviceBClient = { send: sendMock } as unknown as ClientProxy;
  const rabbitmqConfiguration = {
    rpcTimeoutMs: 10_000,
  } as unknown as ConfigType<typeof rabbitmqConfig>;
  const reportConfiguration: ReportConfiguration = { dir: reportDirectory };
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
    reportConfiguration,
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

async function waitFor(
  condition: () => boolean,
  description: string,
  timeoutMs = 2000,
): Promise<void> {
  const startTime = Date.now();

  while (!condition()) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`Timeout waiting for ${description} after ${timeoutMs}ms`);
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
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
    const bound: BoundRequest<typeof GetReportRequestSchema> = {
      data: { importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
    };

    it('should delete the report file, when the response closes after finishing normally', async () => {
      const reportPath = join(reportDirectory, 'report.pdf');
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- test fixture inside a temp directory this spec owns.
      writeFileSync(reportPath, '%PDF-1.4 fake report body');
      const sendMock = vi.fn().mockReturnValue(of({ reportPath }));
      const warn = vi.fn();
      const error = vi.fn();
      const controller = buildController(
        sendMock,
        { warn, error },
        requestContextService,
        reportDirectory,
      );
      const response = buildFakeResponse();

      await requestContextService.run(
        { correlationId: 'correlation-id', requestId: 'request-id' },
        () => controller.getPdfReport(bound, response),
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
      const controller = buildController(
        sendMock,
        { warn, error },
        requestContextService,
        reportDirectory,
      );
      const response = buildFakeResponse();

      await requestContextService.run(
        { correlationId: 'correlation-id', requestId: 'request-id' },
        () => controller.getPdfReport(bound, response),
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
      const controller = buildController(
        sendMock,
        { warn, error },
        requestContextService,
        reportDirectory,
      );
      const response = buildFakeResponse();

      await requestContextService.run(
        { correlationId: 'correlation-id', requestId: 'request-id' },
        () => controller.getPdfReport(bound, response),
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
      const controller = buildController(
        sendMock,
        { warn, error },
        requestContextService,
        reportDirectory,
      );
      const response = buildFakeResponse();

      await requestContextService.run(
        { correlationId: 'correlation-id', requestId: 'request-id' },
        () => controller.getPdfReport(bound, response),
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
      const controller = buildController(
        sendMock,
        { warn, error },
        requestContextService,
        reportDirectory,
      );
      const response = buildFakeResponse();

      await requestContextService.run(
        { correlationId: 'correlation-id', requestId: 'request-id' },
        () => controller.getPdfReport(bound, response),
      );
      await waitFor(() => warn.mock.calls.length > 0, 'the delete-failure warning to be logged');

      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ reportPath }),
        'failed to stream generated PDF report file',
      );
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ reportPath }),
        'failed to delete generated PDF report file',
      );
    });

    it('should throw, when the RMQ reply reportPath resolves outside the configured report directory', async () => {
      const outsideDirectory = mkdtempSync(join(tmpdir(), 'reports-controller-outside-'));
      const reportPath = join(outsideDirectory, 'report.pdf');
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- test fixture inside a temp directory this spec owns.
      writeFileSync(reportPath, '%PDF-1.4 fake report body');
      const sendMock = vi.fn().mockReturnValue(of({ reportPath }));
      const warn = vi.fn();
      const error = vi.fn();
      const controller = buildController(
        sendMock,
        { warn, error },
        requestContextService,
        reportDirectory,
      );
      const response = buildFakeResponse();

      try {
        await expect(
          requestContextService.run(
            { correlationId: 'correlation-id', requestId: 'request-id' },
            () => controller.getPdfReport(bound, response),
          ),
        ).rejects.toThrow(ReportPathOutsideConfiguredDirectoryError);
      } finally {
        rmSync(outsideDirectory, { recursive: true, force: true });
      }
    });

    it('should not delete the outside file, when the RMQ reply reportPath resolves outside the configured report directory', async () => {
      const outsideDirectory = mkdtempSync(join(tmpdir(), 'reports-controller-outside-'));
      const reportPath = join(outsideDirectory, 'report.pdf');
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
      writeFileSync(reportPath, '%PDF-1.4 fake report body');
      const sendMock = vi.fn().mockReturnValue(of({ reportPath }));
      const warn = vi.fn();
      const error = vi.fn();
      const controller = buildController(
        sendMock,
        { warn, error },
        requestContextService,
        reportDirectory,
      );
      const response = buildFakeResponse();

      try {
        await requestContextService
          .run({ correlationId: 'correlation-id', requestId: 'request-id' }, () =>
            controller.getPdfReport(bound, response),
          )
          .catch(() => undefined);
        await flushMicrotasks();

        // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
        expect(existsSync(reportPath)).toBe(true);
      } finally {
        rmSync(outsideDirectory, { recursive: true, force: true });
      }
    });
  });
});
