import { rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import {
  buildArchiveFilename,
  parseImportIdFromUploadTemporaryFilename,
} from '@task1/shared/storage/archive-paths';

import { ArchiveUploadError, UnsupportedArchiveFormatError } from './errors.js';
import { isGzipFile } from './upload-storage.util.js';

export interface IFinalizeUploadOptions {
  file: Express.Multer.File;
  storageDirectory: string;
  onUnlinkFailed: (path: string, error: unknown) => void;
}

export interface IFinalizedUpload {
  importId: string;
  finalPath: string;
}

/**
 * Turns multer's temp file into the archive service-a will process.
 *
 * Extracted from the controller: verifying magic bytes, deleting a rejected upload and atomically
 * renaming are filesystem concerns, not routing or serialization, and they are the part of the
 * upload path most worth testing on its own.
 */
export async function finalizeUpload(options: IFinalizeUploadOptions): Promise<IFinalizedUpload> {
  const { file, storageDirectory, onUnlinkFailed } = options;

  if (!(await isGzipFile(file.path))) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- file.path is the temp path multer just wrote inside the configured storage directory.
    await unlink(file.path).catch((error: unknown) => {
      onUnlinkFailed(file.path, error);
    });

    throw new UnsupportedArchiveFormatError(file.originalname);
  }

  const importId = parseImportIdFromUploadTemporaryFilename(file.filename);
  const finalPath = join(storageDirectory, buildArchiveFilename(importId));

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- both paths are derived from the configured storage directory and a server-generated UUID, never raw external input.
    await rename(file.path, finalPath);
  } catch (error) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- both paths are derived from the configured storage directory and a server-generated UUID, never raw external input.
    await unlink(file.path).catch(() => undefined);

    const cause = error instanceof Error ? error : undefined;

    throw new ArchiveUploadError(
      `Failed to finalize uploaded archive: ${error instanceof Error ? error.message : String(error)}`,
      importId,
      cause,
    );
  }

  return { importId, finalPath };
}
