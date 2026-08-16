import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

// vi.spyOn cannot redefine a live ESM namespace export, so the module is mocked wholesale here and
// every other export is passed through untouched via vi.importActual.
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
    unlinkMock.mockClear();
  });

  afterEach(() => {
    rmSync(reportDirectory, { recursive: true, force: true });
  });

  describe('getPdfReport', () => {
    const bound: BoundRequest<typeof GetReportRequestSchema> = {
      data: { importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
    };

    it('should not delete the report file it did not produce', async () => {
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
          correlationId: 'correlation-id',
          requestId: 'request-id',
          correlationIdSource: 'inbound',
        },
        () => controller.getPdfReport(bound),
      );
      await flushMicrotasks();

      expect(unlinkMock).not.toHaveBeenCalled();
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
      expect(existsSync(reportPath)).toBe(true);
    });

    it('should not accept a response parameter to register a close listener on', () => {
      // Guards against reintroducing a `@Res()` parameter (and the file-deletion side effect that
      // used to hang off it): the handler must be reachable with only the bound request.
      // eslint-disable-next-line @typescript-eslint/unbound-method -- reading .length off the method reference to assert its arity, never calling it unbound.
      expect(ReportsController.prototype.getPdfReport).toHaveLength(1);
    });

    it('should log an error, when the report file cannot be read', async () => {
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

      await requestContextService.run(
        {
          correlationId: 'correlation-id',
          requestId: 'request-id',
          correlationIdSource: 'inbound',
        },
        () => controller.getPdfReport(bound),
      );
      await waitFor(() => error.mock.calls.length > 0, 'the stream-error to be logged');

      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ reportPath }),
        'failed to stream generated PDF report file',
        expect.anything(),
      );
      expect(warn).not.toHaveBeenCalled();
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
              correlationId: 'correlation-id',
              requestId: 'request-id',
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

      try {
        await requestContextService
          .run(
            {
              correlationId: 'correlation-id',
              requestId: 'request-id',
              correlationIdSource: 'inbound',
            },
            () => controller.getPdfReport(bound),
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
