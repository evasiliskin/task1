import { splitLines } from './split-lines.js';

describe('splitLines', () => {
  // eslint-disable-next-line @typescript-eslint/require-await
  async function* fromChunks(chunks: string[]): AsyncGenerator<Buffer> {
    for (const chunk of chunks) {
      yield Buffer.from(chunk);
    }
  }

  async function collect(source: AsyncGenerator<string>): Promise<string[]> {
    const lines: string[] = [];

    for await (const line of source) {
      lines.push(line);
    }

    return lines;
  }

  it('should yield each line, when a chunk contains multiple newline-terminated lines', async () => {
    const lines = await collect(splitLines(fromChunks(['line1\nline2\nline3\n'])));

    expect(lines).toEqual(['line1', 'line2', 'line3']);
  });

  it('should yield the correct line, when a single line is split across two chunks', async () => {
    const lines = await collect(splitLines(fromChunks(['line1\nli', 'ne2\nline3\n'])));

    expect(lines).toEqual(['line1', 'line2', 'line3']);
  });

  it('should yield the trailing content, when the final chunk has no terminating newline', async () => {
    const lines = await collect(splitLines(fromChunks(['line1\nline2'])));

    expect(lines).toEqual(['line1', 'line2']);
  });

  it('should strip a trailing carriage return, when lines use CRLF endings', async () => {
    const lines = await collect(splitLines(fromChunks(['line1\r\nline2\r\n'])));

    expect(lines).toEqual(['line1', 'line2']);
  });

  it('should skip blank lines, when consecutive newlines produce an empty line', async () => {
    const lines = await collect(splitLines(fromChunks(['line1\n\nline2\n'])));

    expect(lines).toEqual(['line1', 'line2']);
  });

  it('should yield nothing, when the source is empty', async () => {
    const lines = await collect(splitLines(fromChunks([])));

    expect(lines).toEqual([]);
  });
});
