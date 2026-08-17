import { insertBatches } from './insert-batches.js';

const emptyResult = { insertedCount: 0, duplicateCount: 0, errorCount: 0, errorSample: [] };

// eslint-disable-next-line @typescript-eslint/require-await -- must be an async generator to satisfy AsyncIterable<number[]>, even though it never awaits.
async function* batchesOf(count: number): AsyncGenerator<number[]> {
  for (let index = 0; index < count; index += 1) {
    yield [index];
  }
}

describe('insertBatches', () => {
  it('should insert every batch and report every result, when the stream completes', async () => {
    const seen: number[] = [];

    await insertBatches({
      batches: batchesOf(5),
      concurrency: 2,
      insert: async (batch: number[]) => {
        await Promise.resolve();

        return { ...emptyResult, insertedCount: batch[0] ?? 0 };
      },
      onResult: (result) => seen.push(result.insertedCount),
    });

    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('should never exceed the configured concurrency, when many batches are streamed', async () => {
    let inFlight = 0;
    let peak = 0;

    await insertBatches({
      batches: batchesOf(10),
      concurrency: 3,
      insert: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;

        return emptyResult;
      },
      onResult: () => undefined,
    });

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it('should run inserts concurrently, when concurrency is greater than one', async () => {
    const startedAt = Date.now();

    await insertBatches({
      batches: batchesOf(4),
      concurrency: 4,
      insert: async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));

        return emptyResult;
      },
      onResult: () => undefined,
    });

    expect(Date.now() - startedAt).toBeLessThan(120);
  });

  it('should propagate the failure, when an insert rejects', async () => {
    const failure = new Error('write failed');

    await expect(
      insertBatches({
        batches: batchesOf(4),
        concurrency: 2,
        insert: async (batch: number[]) => {
          await Promise.resolve();

          if (batch[0] === 1) {
            throw failure;
          }

          return emptyResult;
        },
        onResult: () => undefined,
      }),
    ).rejects.toBe(failure);
  });

  it('should stop pulling new batches, when an insert fails', async () => {
    let pulled = 0;

    // eslint-disable-next-line @typescript-eslint/require-await -- must be an async generator to satisfy AsyncIterable<number[]>, even though it never awaits.
    async function* tracked(): AsyncGenerator<number[]> {
      for (let index = 0; index < 100; index += 1) {
        pulled += 1;
        yield [index];
      }
    }

    await expect(
      insertBatches({
        batches: tracked(),
        concurrency: 2,
        insert: async () => {
          await Promise.resolve();

          throw new Error('boom');
        },
        onResult: () => undefined,
      }),
    ).rejects.toThrow('boom');

    expect(pulled).toBeLessThan(10);
  });

  it('should complete cleanly, when the batch stream is empty', async () => {
    await expect(
      insertBatches({
        batches: batchesOf(0),
        concurrency: 2,
        insert: async () => {
          await Promise.resolve();

          return emptyResult;
        },
        onResult: () => undefined,
      }),
    ).resolves.toBeUndefined();
  });
});
