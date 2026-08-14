import { createWriteStream } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { buildArchiveUrl } from './archive-url.util.js';
import { ArchiveDownloadError, isRetryableDownloadError } from './errors.js';
import { fetchArchiveStream, type HttpGetFunction } from './fetch-archive-stream.js';

export interface IDownloadArchiveOptions {
  baseUrl: string;
  storageDirectory: string;
  timeoutMs: number;
  totalTimeoutMs: number;
  maxAttempts: number;
  retryDelayMs: number;
}

export interface IDownloadArchiveResult {
  filePath: string;
}

export async function downloadArchive(
  dateHour: string,
  options: IDownloadArchiveOptions,
  httpGet?: HttpGetFunction,
): Promise<IDownloadArchiveResult> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await attemptDownload(dateHour, options, httpGet);
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
  options: IDownloadArchiveOptions,
  httpGet?: HttpGetFunction,
): Promise<IDownloadArchiveResult> {
  const url = buildArchiveUrl(dateHour, options.baseUrl);

  const finalPath = join(options.storageDirectory, `${dateHour}.json.gz`);
  const temporaryPath = `${finalPath}.tmp`;

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- storageDirectory comes from validated env config (StorageConfiguration), not raw external input.
  await mkdir(options.storageDirectory, { recursive: true });

  try {
    const responseStream = await fetchArchiveStream(url, options.timeoutMs, httpGet);

    const totalTimeout = setTimeout(() => {
      responseStream.destroy(
        new Error(
          `Archive download timed out after ${options.totalTimeoutMs}ms (total duration exceeded)`,
        ),
      );
    }, options.totalTimeoutMs);

    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- temporaryPath is derived from validated storage config + a regex-validated dateHour, never raw external input.
      await pipeline(responseStream, createWriteStream(temporaryPath));
    } finally {
      clearTimeout(totalTimeout);
    }
  } catch (error) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
    await unlink(temporaryPath).catch(() => undefined);

    if (error instanceof ArchiveDownloadError) {
      throw error;
    }

    const cause = error instanceof Error ? error : undefined;

    throw new ArchiveDownloadError(
      `Archive download stream failed: ${error instanceof Error ? error.message : String(error)}`,
      url,
      undefined,
      cause,
    );
  }

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
  await rename(temporaryPath, finalPath);

  return { filePath: finalPath };
}
