import { randomUUID } from 'node:crypto';
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
    it('should derive the import id from the namespaced upload temp filename', async () => {
      const warn: LogMock = vi.fn();
      const error: LogMock = vi.fn();
      const { controller, requestContextService } = buildController(storageDirectory, {
        warn,
        error,
      });
      const importId = '11111111-1111-4111-8111-111111111111';
      const temporaryFilePath = join(storageDirectory, `${importId}.upload.tmp`);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- temporaryFilePath is this spec's own mkdtempSync'd fixture path, never external input.
      writeFileSync(temporaryFilePath, Buffer.from('gzipped-content'));
      isGzipFileMock.mockResolvedValue(true);

      const result = await requestContextService.run(
        { correlationId: randomUUID(), requestId: 'req-1', correlationIdSource: 'inbound' },
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
      // A path that never existed: the real fs unlink() call this exercises fails with ENOENT.
      const missingFilePath = join(storageDirectory, `${randomUUID()}.tmp`);
      isGzipFileMock.mockResolvedValue(false);

      await expect(
        controller.upload(
          { rejectedFilename: undefined } as unknown as Parameters<
            UploadImportController['upload']
          >[0],
          {
            path: missingFilePath,
            originalname: 'archive.json.gz',
            filename: `${randomUUID()}.tmp`,
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
      // A storage directory that does not exist makes the controller's rename() call fail.
      const missingStorageDirectory = join(storageDirectory, 'does-not-exist');
      const { controller } = buildController(missingStorageDirectory, { warn, error });
      const importId = randomUUID();
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

      // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
      expect(existsSync(temporaryFilePath)).toBe(false);
    });
  });
});
