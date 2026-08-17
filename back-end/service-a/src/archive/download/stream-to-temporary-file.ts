import { createWriteStream } from 'node:fs';
import { type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { ArchiveDownloadError } from './errors.js';

export async function streamToTemporaryFile(
  stream: Readable,
  temporaryPath: string,
  totalTimeoutMs: number,
): Promise<void> {
  const watchdog = setTimeout(() => {
    stream.destroy(
      new Error(`Archive download timed out after ${totalTimeoutMs}ms (total duration exceeded)`),
    );
  }, totalTimeoutMs);

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- temporaryPath is derived from validated storage config and a server-generated importId, never raw external input.
    await pipeline(stream, createWriteStream(temporaryPath));
  } finally {
    clearTimeout(watchdog);
  }
}

export function toDownloadError(error: unknown, url: string): ArchiveDownloadError {
  if (error instanceof ArchiveDownloadError) {
    return error;
  }

  return new ArchiveDownloadError(
    `Archive download stream failed: ${error instanceof Error ? error.message : String(error)}`,
    url,
    undefined,
    error instanceof Error ? error : undefined,
  );
}
