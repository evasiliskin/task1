import { open } from 'node:fs/promises';

const ARCHIVE_FILENAME_PATTERN = /\.json\.gz$/i;
const GZIP_MAGIC_BYTE_0 = 0x1f;
const GZIP_MAGIC_BYTE_1 = 0x8b;

export function isArchiveFilename(filename: string): boolean {
  return ARCHIVE_FILENAME_PATTERN.test(filename);
}

export async function isGzipFile(filePath: string): Promise<boolean> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- filePath is the temp path multer just wrote inside the configured storage directory.
  const handle = await open(filePath, 'r');

  try {
    const buffer = Buffer.alloc(2);
    const { bytesRead } = await handle.read(buffer, 0, 2, 0);

    return bytesRead === 2 && buffer[0] === GZIP_MAGIC_BYTE_0 && buffer[1] === GZIP_MAGIC_BYTE_1;
  } finally {
    await handle.close();
  }
}
