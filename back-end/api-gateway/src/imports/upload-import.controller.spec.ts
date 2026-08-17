import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type ClientProxy } from '@nestjs/microservices';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { type LoggerService } from '@task1/shared/logger/logger.service';
import { type LogFields } from '@task1/shared/logger/types';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { ContextPropagatingClient } from '@task1/shared/request-context/rmq/context-propagating.client';
import { of } from 'rxjs';

import { type StorageConfiguration } from '../config/storage.config.js';

import { ArchiveUploadError, UnsupportedArchiveFormatError } from './errors.js';
import { UploadImportController } from './upload-import.controller.js';
import * as uploadStorageUtil from './upload-storage.util.js';

type LogMock = ReturnType<
  typeof vi.fn<(fields: LogFields, message: string, error?: unknown) => void>
>;

vi.mock('./upload-storage.util.js', async () => {
  const actual = await vi.importActual<typeof uploadStorageUtil>('./upload-storage.util.js');

  return { ...actual, isGzipFile: vi.fn() };
});

const isGzipFileMock = vi.mocked(uploadStorageUtil.isGzipFile);

function buildController(
  storageDirectory: string,
  loggerMocks: { warn: LogMock; error: LogMock },
): { controller: UploadImportController; requestContextService: RequestContextService } {
  const requestContextService = new RequestContextService();
  const serviceAClient = { emit: vi.fn(() => of(undefined)) } as unknown as ClientProxy;
  const storageConfiguration: StorageConfiguration = {
    dir: storageDirectory,
    uploadRetentionMs: 86_400_000,
    uploadSweepIntervalMs: 900_000,
  };
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

  const controller = new UploadImportController(
    serviceAClient,
    storageConfiguration,
    new ContextPropagatingClient(requestContextService),
    loggerService,
  );

  return { controller, requestContextService };
}

describe('UploadImportController', () => {
  let storageDirectory: string;

  beforeEach(() => {
    storageDirectory = mkdtempSync(join(tmpdir(), 'upload-import-controller-spec-'));
    isGzipFileMock.mockReset();
  });

  afterEach(() => {
    rmSync(storageDirectory, { recursive: true, force: true });
  });

  describe('upload', () => {
    it('should derive the import id from the upload temp filename, when the upload is finalized', async () => {
      const warn: LogMock = vi.fn();
      const error: LogMock = vi.fn();
      const { controller, requestContextService } = buildController(storageDirectory, {
        warn,
        error,
      });
      const importId = '3f8a1c72-5d94-4b1e-a0f6-2c7d9e4b8a51';
      const temporaryFilePath = join(storageDirectory, `${importId}.upload.tmp`);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- temporaryFilePath is this spec's own mkdtempSync'd fixture path, never external input.
      writeFileSync(temporaryFilePath, Buffer.from('gzipped-content'));
      isGzipFileMock.mockResolvedValue(true);

      const result = await requestContextService.run(
        {
          correlationId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
          correlationIdSource: 'inbound',
        },
        () =>
          controller.upload(
            { rejectedFilename: undefined } as unknown as Parameters<
              UploadImportController['upload']
            >[0],
            {
              path: temporaryFilePath,
              originalname: 'archive.json.gz',
              filename: `${importId}.upload.tmp`,
            } as unknown as Express.Multer.File,
          ),
      );

      expect(result).toEqual({ importId });
    });

    it('should log a warning and still reject with 400, when removing a rejected non-gzip upload fails', async () => {
      const warn: LogMock = vi.fn();
      const error: LogMock = vi.fn();
      const { controller } = buildController(storageDirectory, { warn, error });
      const rejectedImportId = 'c56a4180-65aa-42ec-a945-5fd21dec0538';
      const missingFilePath = join(storageDirectory, `${rejectedImportId}.tmp`);
      isGzipFileMock.mockResolvedValue(false);

      await expect(
        controller.upload(
          { rejectedFilename: undefined } as unknown as Parameters<
            UploadImportController['upload']
          >[0],
          {
            path: missingFilePath,
            originalname: 'archive.json.gz',
            filename: `${rejectedImportId}.tmp`,
          } as unknown as Express.Multer.File,
        ),
      ).rejects.toBeInstanceOf(UnsupportedArchiveFormatError);

      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ path: missingFilePath }),
        'Failed to remove an upload rejected as non-gzip content',
        expect.anything(),
      );
    });

    it('should throw an ArchiveUploadError and clean up the temp file, when finalizing the upload fails to rename', async () => {
      const warn: LogMock = vi.fn();
      const error: LogMock = vi.fn();
      const missingStorageDirectory = join(storageDirectory, 'does-not-exist');
      const { controller } = buildController(missingStorageDirectory, { warn, error });
      const importId = '9b2b4d1e-6f3a-4c8e-9d2a-8f1e5c7a3b04';
      const temporaryFilePath = join(storageDirectory, `${importId}.tmp`);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- temporaryFilePath is this spec's own mkdtempSync'd fixture path, never external input.
      writeFileSync(temporaryFilePath, Buffer.from('gzipped-content'));
      isGzipFileMock.mockResolvedValue(true);

      await expect(
        controller.upload(
          { rejectedFilename: undefined } as unknown as Parameters<
            UploadImportController['upload']
          >[0],
          {
            path: temporaryFilePath,
            originalname: 'archive.json.gz',
            filename: `${importId}.tmp`,
          } as unknown as Express.Multer.File,
        ),
      ).rejects.toBeInstanceOf(ArchiveUploadError);

      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox directory, not external input.
      expect(existsSync(temporaryFilePath)).toBe(false);
    });
  });

  describe('upload throttling', () => {
    const originalEnvironment = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnvironment };
    });

    const readThrottleMetadata = (): Record<string, { limit: unknown; ttl: unknown }> => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- used only as a Reflect metadata target, never invoked, so unbound `this` is not a risk
      const uploadMethod = UploadImportController.prototype.upload;
      const limitFn = Reflect.getMetadata('THROTTLER:LIMITdefault', uploadMethod) as unknown;
      const ttlFn = Reflect.getMetadata('THROTTLER:TTLdefault', uploadMethod) as unknown;

      return {
        default: {
          limit: limitFn,
          ttl: ttlFn,
        },
      };
    };

    it('should resolve the upload limit from configuration, when a request is handled', () => {
      process.env.THROTTLE_UPLOAD_LIMIT = '9';

      const metadata = readThrottleMetadata();
      const resolve = metadata.default.limit as () => number;

      expect(typeof resolve).toBe('function');
      expect(resolve()).toBe(9);
    });

    it('should resolve the upload ttl from configuration, when a request is handled', () => {
      process.env.THROTTLE_TTL_MS = '15000';

      const metadata = readThrottleMetadata();
      const resolve = metadata.default.ttl as () => number;

      expect(resolve()).toBe(15_000);
    });
  });
});
