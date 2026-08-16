import { type IInsertBatchResult } from './insert-batch.js';

export interface IInsertBatchesOptions<TBatch> {
  batches: AsyncIterable<TBatch>;
  concurrency: number;
  insert: (batch: TBatch) => Promise<IInsertBatchResult>;
  onResult: (result: IInsertBatchResult) => void;
}

/**
 * Writes batches with a fixed number in flight.
 *
 * Awaiting each insert before pulling the next batch meant gunzip, parse and the Mongo write never
 * overlapped — an import cost `parse + insert` per batch rather than `max(parse, insert)`, and held
 * its RabbitMQ prefetch slot for the whole duration.
 *
 * Bounded, never unbounded: releasing every batch at once would exhaust the driver's connection
 * pool and undo this phase's memory ceiling. The first failure stops the pull loop so a broken
 * write does not drag the rest of the archive through the pipeline before surfacing.
 */
export async function insertBatches<TBatch>(options: IInsertBatchesOptions<TBatch>): Promise<void> {
  const inFlight = new Set<Promise<void>>();
  let failure: unknown;

  const track = (batch: TBatch): void => {
    const tracked: Promise<void> = options
      .insert(batch)
      .then((result) => {
        options.onResult(result);
      })
      .catch((error: unknown) => {
        failure ??= error;
      })
      .finally(() => {
        inFlight.delete(tracked);
      });

    inFlight.add(tracked);
  };

  for await (const batch of options.batches) {
    if (failure !== undefined) {
      break;
    }

    track(batch);

    if (inFlight.size >= options.concurrency) {
      await Promise.race(inFlight);
    }
  }

  await Promise.all(inFlight);

  if (failure !== undefined) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- rethrowing whatever `insert` rejected with, preserving its original type instead of wrapping it.
    throw failure;
  }
}
