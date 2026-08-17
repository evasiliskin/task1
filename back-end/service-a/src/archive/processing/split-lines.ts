import { StringDecoder } from 'node:string_decoder';

import { LineTooLongError } from './errors.js';

const CARRIAGE_RETURN_PATTERN = /\r$/;

function stripCarriageReturn(line: string): string {
  return line.replace(CARRIAGE_RETURN_PATTERN, '');
}

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

    if (Buffer.byteLength(remainder, 'utf8') > maxLineBytes) {
      throw new LineTooLongError(maxLineBytes);
    }
  }

  const finalLine = stripCarriageReturn(remainder + decoder.end());

  if (finalLine.length > 0) {
    yield finalLine;
  }
}
