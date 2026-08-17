import { LineTooLongError } from './errors.js';
import { splitLines } from './split-lines.js';

const NO_LINE_LIMIT = 1_048_576;

// eslint-disable-next-line @typescript-eslint/require-await -- must be an async generator to satisfy AsyncIterable<Buffer>, even though it never awaits.
async function* fromBuffers(...buffers: Buffer[]): AsyncGenerator<Buffer> {
  for (const buffer of buffers) {
    yield buffer;
  }
}

async function collect(source: AsyncIterable<string>): Promise<string[]> {
  const lines: string[] = [];

  for await (const line of source) {
    lines.push(line);
  }

  return lines;
}

describe('splitLines', () => {
  it('should split on newlines and drop empty lines, when the chunk holds several lines', async () => {
    const source = fromBuffers(Buffer.from('a\n\nb\n', 'utf8'));

    expect(await collect(splitLines(source, NO_LINE_LIMIT))).toEqual(['a', 'b']);
  });

  it('should strip the carriage return, when a line ends with CRLF', async () => {
    const source = fromBuffers(Buffer.from('a\r\nb\r\n', 'utf8'));

    expect(await collect(splitLines(source, NO_LINE_LIMIT))).toEqual(['a', 'b']);
  });

  it('should emit the final line, when it has no trailing newline', async () => {
    const source = fromBuffers(Buffer.from('a\nb', 'utf8'));

    expect(await collect(splitLines(source, NO_LINE_LIMIT))).toEqual(['a', 'b']);
  });

  it('should join the line, when it is split across two chunks', async () => {
    const source = fromBuffers(Buffer.from('hel', 'utf8'), Buffer.from('lo\n', 'utf8'));

    expect(await collect(splitLines(source, NO_LINE_LIMIT))).toEqual(['hello']);
  });

  it('should yield the lines in order, when one chunk holds many of them', async () => {
    const source = fromBuffers(Buffer.from('a\nb\nc\nd\n', 'utf8'));

    expect(await collect(splitLines(source, NO_LINE_LIMIT))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('should preserve the character, when a two-byte character spans a chunk boundary', async () => {
    const encoded = Buffer.from('héllo wörld\n', 'utf8');
    const splitAt = encoded.indexOf(0xc3) + 1;
    const source = fromBuffers(encoded.subarray(0, splitAt), encoded.subarray(splitAt));

    expect(await collect(splitLines(source, NO_LINE_LIMIT))).toEqual(['héllo wörld']);
  });

  it('should preserve the emoji, when a four-byte emoji spans a chunk boundary', async () => {
    const encoded = Buffer.from('a 🎉 b\n', 'utf8');
    const source = fromBuffers(encoded.subarray(0, 4), encoded.subarray(4));

    expect(await collect(splitLines(source, NO_LINE_LIMIT))).toEqual(['a 🎉 b']);
  });

  it('should throw, when a single unterminated line exceeds the byte budget', async () => {
    const source = fromBuffers(Buffer.from('x'.repeat(100), 'utf8'));

    await expect(collect(splitLines(source, 10))).rejects.toBeInstanceOf(LineTooLongError);
  });

  it('should not throw, when many short lines together exceed the budget', async () => {
    const source = fromBuffers(Buffer.from('aaaa\nbbbb\ncccc\n', 'utf8'));

    expect(await collect(splitLines(source, 6))).toEqual(['aaaa', 'bbbb', 'cccc']);
  });

  it('should throw, when a newline-terminated line exceeds the budget within one chunk', async () => {
    const source = fromBuffers(Buffer.from(`${'x'.repeat(100)}\n`, 'utf8'));

    await expect(collect(splitLines(source, 10))).rejects.toBeInstanceOf(LineTooLongError);
  });
});
