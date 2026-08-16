import { StringDecoder } from 'node:string_decoder';

import { LineTooLongError } from './errors.js';

const CARRIAGE_RETURN_PATTERN = /\r$/;

function stripCarriageReturn(line: string): string {
  return line.replace(CARRIAGE_RETURN_PATTERN, '');
}

/**
 * Splits a byte stream into lines.
 *
 * `StringDecoder` rather than `chunk.toString('utf8')`: a multi-byte sequence straddling a chunk
 * boundary would otherwise decode as two replacement characters. The corrupted text still parses as
 * valid JSON, so the damage is silent — bad data lands in MongoDB with no error and no counter.
 *
 * The scan advances an index and slices the remainder once per chunk rather than once per line. The
 * per-line slice was quadratic in chunk size and bought nothing.
 *
 * `maxLineBytes` bounds the buffer: without it, a valid gzip containing no newline buffers its
 * entire decompressed payload into one string.
 */
export async function* splitLines(
  source: AsyncIterable<Buffer>,
  maxLineBytes: number,
): AsyncGenerator<string> {
  const decoder = new StringDecoder('utf8');
  let remainder = '';

  for await (const chunk of source) {
    remainder += decoder.write(chunk);

    let lineStart = 0;
    let newlineIndex = remainder.indexOf('\n', lineStart);

    while (newlineIndex !== -1) {
      const rawSlice = remainder.slice(lineStart, newlineIndex);

      // Checked here too: a terminated line found within the same chunk never reaches the
      // leftover-remainder check below, so it must be bounded at extraction time as well.
      if (Buffer.byteLength(rawSlice, 'utf8') > maxLineBytes) {
        throw new LineTooLongError(maxLineBytes);
      }

      const line = stripCarriageReturn(rawSlice);

      if (line.length > 0) {
        yield line;
      }

      lineStart = newlineIndex + 1;
      newlineIndex = remainder.indexOf('\n', lineStart);
    }

    remainder = remainder.slice(lineStart);

    // Checked per chunk, not per byte: whatever is left is by definition one unterminated line.
    if (Buffer.byteLength(remainder, 'utf8') > maxLineBytes) {
      throw new LineTooLongError(maxLineBytes);
    }
  }

  const finalLine = stripCarriageReturn(remainder + decoder.end());

  if (finalLine.length > 0) {
    yield finalLine;
  }
}
