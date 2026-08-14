import { batchEvents } from './batch-events.js';

describe('batchEvents', () => {
  // eslint-disable-next-line @typescript-eslint/require-await
  async function* fromArray<T>(items: T[]): AsyncGenerator<T> {
    for (const item of items) {
      yield item;
    }
  }

  async function collect<T>(source: AsyncGenerator<T[]>): Promise<T[][]> {
    const batches: T[][] = [];

    for await (const batch of source) {
      batches.push(batch);
    }

    return batches;
  }

  it('should yield evenly-sized batches, when the input count is an exact multiple of batchSize', async () => {
    const batches = await collect(batchEvents(fromArray([1, 2, 3, 4]), 2));

    expect(batches).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('should yield a shorter final batch, when the input count is not a multiple of batchSize', async () => {
    const batches = await collect(batchEvents(fromArray([1, 2, 3, 4, 5]), 2));

    expect(batches).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('should yield one batch containing everything, when the input is shorter than batchSize', async () => {
    const batches = await collect(batchEvents(fromArray([1, 2]), 5));

    expect(batches).toEqual([[1, 2]]);
  });

  it('should yield nothing, when the input is empty', async () => {
    const batches = await collect(batchEvents(fromArray<number>([]), 5));

    expect(batches).toEqual([]);
  });

  it('should yield one batch per item, when batchSize is 1', async () => {
    const batches = await collect(batchEvents(fromArray([1, 2, 3]), 1));

    expect(batches).toEqual([[1], [2], [3]]);
  });
});
