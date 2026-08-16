import { ArchiveTooLargeError } from './errors.js';

/**
 * Caps how far a gzip stream is allowed to expand.
 *
 * `createGunzip()` will happily inflate a few megabytes into gigabytes, and the upload endpoint's
 * size limit applies to the compressed bytes, so without this a gzip bomb reaches the heap
 * unchecked. Throwing from the generator propagates through the consuming `for await`, which
 * destroys the upstream stream and releases the file handle.
 */
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
