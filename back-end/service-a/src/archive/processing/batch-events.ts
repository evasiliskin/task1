export async function* batchEvents<T>(
  events: AsyncIterable<T>,
  batchSize: number,
): AsyncGenerator<T[]> {
  let currentBatch: T[] = [];

  for await (const event of events) {
    currentBatch.push(event);

    if (currentBatch.length >= batchSize) {
      yield currentBatch;
      currentBatch = [];
    }
  }

  if (currentBatch.length > 0) {
    yield currentBatch;
  }
}
