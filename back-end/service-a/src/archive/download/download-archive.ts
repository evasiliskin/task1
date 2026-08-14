import { createWriteStream } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { buildArchiveUrl } from './archive-url.util.js';
import { ArchiveDownloadError } from './errors.js';
import { fetchArchiveStream, type HttpGetFunction } from './fetch-archive-stream.js';

export interface IDownloadArchiveOptions {
  baseUrl: string;
  storageDirectory: string;
  timeoutMs: number;
}

export interface IDownloadArchiveResult {
  filePath: string;
}

export async function downloadArchive(
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

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- temporaryPath is derived from validated storage config + a regex-validated dateHour, never raw external input.
    await pipeline(responseStream, createWriteStream(temporaryPath));
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
