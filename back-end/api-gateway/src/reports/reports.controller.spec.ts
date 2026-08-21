import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type StreamableFile } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { type LoggerService } from '@task1/shared/logger/logger.service';
import { type LogFields } from '@task1/shared/logger/types';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { ContextPropagatingClient } from '@task1/shared/request-context/rmq/context-propagating.client';
import { of } from 'rxjs';

import type rabbitmqConfig from '../config/rabbitmq.config.js';
import { type ReportConfiguration } from '../config/report.config.js';
import { type BoundRequest } from '../contract/decorators/model-binder.decorator.js';

import { ReportPathOutsideConfiguredDirectoryError } from './errors.js';
import { ReportsController } from './reports.controller.js';
import { type GetReportRequestSchema } from './schemas/get-report-request.schema.js';

const unlinkMock = vi.fn();

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof fsPromises>('node:fs/promises');

  return {
    ...actual,
    unlink: (...args: Parameters<typeof actual.unlink>) => {
      unlinkMock(...args);

      return actual.unlink(...args);
    },
  };
});

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
    new ContextPropagatingClient(requestContextService),
    rabbitmqConfiguration,
    reportConfiguration,
    loggerService,
  );
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 20);
  });
}

function discardStream(streamable: StreamableFile): void {
  const stream = streamable.getStream();

  stream.on('error', () => undefined);
  stream.destroy();
}

describe('ReportsController', () => {
  let reportDirectory: string;
  let requestContextService: RequestContextService;

  beforeEach(() => {
    reportDirectory = mkdtempSync(join(tmpdir(), 'reports-controller-spec-'));
    requestContextService = new RequestContextService();
    unlinkMock.mockClear();
  });

  afterEach(() => {
    rmSync(reportDirectory, { recursive: true, force: true });
  });

  describe('getPdfReport', () => {
    const bound: BoundRequest<typeof GetReportRequestSchema> = {
      data: { importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
    };

    it('should leave the report file in place, when it did not produce the file', async () => {
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

      await requestContextService.run(
        {
          correlationId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
          correlationIdSource: 'inbound',
        },
        () => controller.getPdfReport(bound),
      );
      await flushMicrotasks();

      expect(unlinkMock).not.toHaveBeenCalled();
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox directory, not external input.
      expect(existsSync(reportPath)).toBe(true);
    });

    it('should take only the bound request parameter, when the handler signature is inspected', () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- reading .length off the method reference to assert its arity, never calling it unbound.
      expect(ReportsController.prototype.getPdfReport).toHaveLength(1);
    });

    it('should log the stream failure, when the report file cannot be read', async () => {
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

      const streamable = await requestContextService.run(
        {
          correlationId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
          correlationIdSource: 'inbound',
        },
        () => controller.getPdfReport(bound),
      );

      discardStream(streamable);

      streamable.errorLogger(new Error(`ENOENT: no such file or directory, open '${reportPath}'`));

      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ reportPath }),
        'failed to stream generated PDF report file',
        expect.anything(),
      );
      expect(warn).not.toHaveBeenCalled();
    });

    it('should answer 500 without leaking the server path, when the report stream fails before the headers are sent', async () => {
      const reportPath = join(reportDirectory, 'report.pdf');
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- test fixture inside a temp directory this spec owns.
      writeFileSync(reportPath, '%PDF-1.4 fake report body');
      const controller = buildController(
        vi.fn().mockReturnValue(of({ reportPath })),
        { warn: vi.fn(), error: vi.fn() },
        requestContextService,
        reportDirectory,
      );

      const streamable = await requestContextService.run(
        {
          correlationId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
          correlationIdSource: 'inbound',
        },
        () => controller.getPdfReport(bound),
      );

      discardStream(streamable);

      const response = {
        destroyed: false,
        headersSent: false,
        statusCode: 200,
        send: vi.fn(),
        end: vi.fn(),
      };

      streamable.errorHandler(
        new Error(`ENOENT: no such file or directory, open '${reportPath}'`),
        response,
      );

      expect(response.statusCode).toBe(500);
      expect(response.send).toHaveBeenCalledWith('The generated report could not be read.');
      expect(response.send).not.toHaveBeenCalledWith(expect.stringContaining(reportPath));
    });

    it('should only end the response, when the report stream fails after the headers are sent', async () => {
      const reportPath = join(reportDirectory, 'report.pdf');
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- test fixture inside a temp directory this spec owns.
      writeFileSync(reportPath, '%PDF-1.4 fake report body');
      const controller = buildController(
        vi.fn().mockReturnValue(of({ reportPath })),
        { warn: vi.fn(), error: vi.fn() },
        requestContextService,
        reportDirectory,
      );

      const streamable = await requestContextService.run(
        {
          correlationId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
          correlationIdSource: 'inbound',
        },
        () => controller.getPdfReport(bound),
      );

      discardStream(streamable);

      const response = {
        destroyed: false,
        headersSent: true,
        statusCode: 200,
        send: vi.fn(),
        end: vi.fn(),
      };

      streamable.errorHandler(new Error('socket hang up'), response);

      expect(response.send).not.toHaveBeenCalled();
      expect(response.end).toHaveBeenCalledTimes(1);
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

      try {
        await expect(
          requestContextService.run(
            {
              correlationId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
              requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
              correlationIdSource: 'inbound',
            },
            () => controller.getPdfReport(bound),
          ),
        ).rejects.toThrow(ReportPathOutsideConfiguredDirectoryError);
      } finally {
        rmSync(outsideDirectory, { recursive: true, force: true });
      }
    });

    it('should not delete the outside file, when the RMQ reply reportPath resolves outside the configured report directory', async () => {
      const outsideDirectory = mkdtempSync(join(tmpdir(), 'reports-controller-outside-'));
      const reportPath = join(outsideDirectory, 'report.pdf');
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox directory, not external input.
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

      try {
        await requestContextService
          .run(
            {
              correlationId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
              requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
              correlationIdSource: 'inbound',
            },
            () => controller.getPdfReport(bound),
          )
          .catch(() => undefined);
        await flushMicrotasks();

        // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox directory, not external input.
        expect(existsSync(reportPath)).toBe(true);
      } finally {
        rmSync(outsideDirectory, { recursive: true, force: true });
      }
    });
  });
});
