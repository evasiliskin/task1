import { mkdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import {
  buildArchiveFilename,
  buildDownloadTemporaryFilename,
} from '@task1/shared/storage/archive-paths';

import { buildArchiveUrl } from './archive-url.util.js';
import { isRetryableDownloadError } from './errors.js';
import { fetchArchiveStream, type HttpGetFunction } from './fetch-archive-stream.js';
import { streamToTemporaryFile, toDownloadError } from './stream-to-temporary-file.js';

export interface IDownloadArchiveOptions {
  baseUrl: string;
  storageDirectory: string;
  timeoutMs: number;
  totalTimeoutMs: number;
  maxAttempts: number;
  retryDelayMs: number;
  httpGet: HttpGetFunction;
}

export interface IDownloadArchiveResult {
  filePath: string;
}

export async function downloadArchive(
  dateHour: string,
  importId: string,
  options: IDownloadArchiveOptions,
): Promise<IDownloadArchiveResult> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await attemptDownload(dateHour, importId, options);
    } catch (error) {
      lastError = error;

      if (!isRetryableDownloadError(error) || attempt === options.maxAttempts) {
        throw error;
      }

      await delay(options.retryDelayMs * attempt);
    }
  }

  throw lastError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function attemptDownload(
  dateHour: string,
  importId: string,
  options: IDownloadArchiveOptions,
): Promise<IDownloadArchiveResult> {
  const url = buildArchiveUrl(dateHour, options.baseUrl);

  // Keyed on importId, not dateHour: two imports of the same hour are two distinct runs and must
  // not share a path. The `archive` label in the lifecycle events stays dateHour-based.
  const finalPath = join(options.storageDirectory, buildArchiveFilename(importId));
  const temporaryPath = join(options.storageDirectory, buildDownloadTemporaryFilename(importId));

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- storageDirectory comes from validated env config (StorageConfiguration), not raw external input.
  await mkdir(options.storageDirectory, { recursive: true });

  try {
    const responseStream = await fetchArchiveStream(url, options.timeoutMs, options.httpGet);

    await streamToTemporaryFile(responseStream, temporaryPath, options.totalTimeoutMs);
  } catch (error) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- temporaryPath is derived from validated storage config and a server-generated importId, never raw external input.
    await unlink(temporaryPath).catch(() => undefined);

    throw toDownloadError(error, url);
  }

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- finalPath is derived from validated storage config and a server-generated importId, never raw external input.
  await rename(temporaryPath, finalPath);

  return { filePath: finalPath };
}
