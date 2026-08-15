import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';

import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection } from 'mongodb';

import { batchEvents } from './batch-events.js';
import { ArchiveProcessingError } from './errors.js';
import { insertBatch, type IWriteErrorSample } from './insert-batch.js';
import { parseAndValidate, type OnInvalidLine } from './parse-and-validate.js';
import { type RawGithubEvent } from './raw-github-event.schema.js';
import { splitLines } from './split-lines.js';
import { transformEvent } from './transform-event.js';

export interface IProcessArchiveOptions {
  collection: Collection<IGithubEventDocument>;
  batchSize: number;
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- deliberately a `type`, not an `I`-prefixed `interface`: Phase 5 reuses this exact unprefixed name for `ImportCompletedEvent`'s payload shape.
export type ImportResult = {
  eventsProcessed: number;
  validEvents: number;
  invalidEvents: number;
  duplicateEvents: number;
  errorCount: number;
};

/** Called once per batch that produced non-duplicate write errors. */
export type OnBatchErrors = (errorCount: number, errorSample: readonly IWriteErrorSample[]) => void;

async function* transformEvents(
  rawEvents: AsyncIterable<RawGithubEvent>,
  importId: string,
): AsyncGenerator<IGithubEventDocument> {
  for await (const rawEvent of rawEvents) {
    yield transformEvent(rawEvent, importId);
  }
}

export async function processArchive(
  filePath: string,
  importId: string,
  options: IProcessArchiveOptions,
  onInvalidLine?: OnInvalidLine,
  onBatchErrors?: OnBatchErrors,
): Promise<ImportResult> {
  let invalidEvents = 0;
  let validEvents = 0;
  let duplicateEvents = 0;
  let errorCount = 0;

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename, @typescript-eslint/no-unsafe-assignment -- filePath comes from the download/upload flow's validated storage path, never raw external input; Node's stream typings do not genericize Readable async iteration, so compose's result types as any, but the explicit annotation still gives every downstream usage a real, checked type.
    const archiveStream: AsyncIterable<Buffer> = createReadStream(filePath).compose(createGunzip());
    const lines = splitLines(archiveStream);
    const rawEvents = parseAndValidate(lines, (rawLine, error) => {
      invalidEvents += 1;
      onInvalidLine?.(rawLine, error);
    });
    const documents = transformEvents(rawEvents, importId);
    const batches = batchEvents(documents, options.batchSize);

    for await (const batch of batches) {
      const result = await insertBatch(options.collection, batch);

      validEvents += result.insertedCount;
      duplicateEvents += result.duplicateCount;
      errorCount += result.errorCount;

      if (result.errorCount > 0) {
        onBatchErrors?.(result.errorCount, result.errorSample);
      }
    }
  } catch (error) {
    const cause = error instanceof Error ? error : undefined;

    throw new ArchiveProcessingError(
      `Archive processing failed: ${error instanceof Error ? error.message : String(error)}`,
      importId,
      filePath,
      cause,
    );
  }

  return {
    eventsProcessed: invalidEvents + validEvents + duplicateEvents + errorCount,
    validEvents,
    invalidEvents,
    duplicateEvents,
    errorCount,
  };
}
