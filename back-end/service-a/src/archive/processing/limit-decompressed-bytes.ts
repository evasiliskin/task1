import { ArchiveTooLargeError } from './errors.js';

export async function* limitDecompressedBytes(
  source: AsyncIterable<Buffer>,
  maxBytes: number,
): AsyncGenerator<Buffer> {
  let totalBytes = 0;

  for await (const chunk of source) {
    totalBytes += chunk.length;

    if (totalBytes > maxBytes) {
      throw new ArchiveTooLargeError(maxBytes);
    }

    yield chunk;
  }
}
