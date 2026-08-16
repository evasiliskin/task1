import { ArchiveTooLargeError } from './errors.js';
import { limitDecompressedBytes } from './limit-decompressed-bytes.js';

// eslint-disable-next-line @typescript-eslint/require-await -- must be an async generator to satisfy AsyncIterable<Buffer>, even though it never awaits.
async function* chunksOf(...values: string[]): AsyncGenerator<Buffer> {
  for (const value of values) {
    yield Buffer.from(value, 'utf8');
  }
}

async function collect(source: AsyncIterable<Buffer>): Promise<string> {
  let output = '';

  for await (const chunk of source) {
    output += chunk.toString('utf8');
  }

  return output;
}

describe('limitDecompressedBytes', () => {
  it('should pass every chunk through when the total stays within budget', async () => {
    expect(await collect(limitDecompressedBytes(chunksOf('abc', 'def'), 10))).toBe('abcdef');
  });

  it('should pass through a stream sitting exactly on the budget', async () => {
    expect(await collect(limitDecompressedBytes(chunksOf('abcde'), 5))).toBe('abcde');
  });

  it('should raise once the cumulative size exceeds the budget', async () => {
    await expect(collect(limitDecompressedBytes(chunksOf('abc', 'def'), 5))).rejects.toBeInstanceOf(
      ArchiveTooLargeError,
    );
  });

  it('should stop pulling from the source once the budget is exceeded', async () => {
    const pulled: string[] = [];

    // eslint-disable-next-line @typescript-eslint/require-await -- must be an async generator to satisfy AsyncIterable<Buffer>, even though it never awaits.
    async function* tracked(): AsyncGenerator<Buffer> {
      for (const value of ['aaa', 'bbb', 'ccc']) {
        pulled.push(value);
        yield Buffer.from(value, 'utf8');
      }
    }

    await expect(collect(limitDecompressedBytes(tracked(), 5))).rejects.toBeInstanceOf(
      ArchiveTooLargeError,
    );
    expect(pulled).toEqual(['aaa', 'bbb']);
  });

  it('should count bytes, not characters', async () => {
    // '✅' is three bytes in UTF-8, so two of them exceed a five-byte budget.
    await expect(collect(limitDecompressedBytes(chunksOf('✅', '✅'), 5))).rejects.toBeInstanceOf(
      ArchiveTooLargeError,
    );
  });
});
