import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';

import { AppError } from '@task1/shared/errors/index';
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection } from 'mongodb';

import { batchEvents } from './batch-events.js';
import { ArchiveProcessingError } from './errors.js';
import { ImportCounters } from './import-counters.js';
import { insertBatch, type IWriteErrorSample } from './insert-batch.js';
import { insertBatches } from './insert-batches.js';
import { limitDecompressedBytes } from './limit-decompressed-bytes.js';
import { parseAndValidate, type OnInvalidLine } from './parse-and-validate.js';
import { type RawGithubEvent } from './raw-github-event.schema.js';
import { splitLines } from './split-lines.js';
import { transformEvent } from './transform-event.js';

export interface IProcessArchiveOptions {
  collection: Collection<IGithubEventDocument>;
  batchSize: number;
  maxLineBytes: number;
  maxDecompressedBytes: number;
  insertConcurrency: number;
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- deliberately a `type`, not an `I`-prefixed `interface`: Phase 5 reuses this exact unprefixed name for `ImportCompletedEvent`'s payload shape.
export type ImportResult = {
  eventsProcessed: number;
  validEvents: number;
  invalidEvents: number;
  duplicateEvents: number;
  errorCount: number;
};

export type OnBatchErrors = (errorCount: number, errorSample: readonly IWriteErrorSample[]) => void;

async function* transformEvents(
  rawEvents: AsyncIterable<RawGithubEvent>,
  importId: string,
): AsyncGenerator<IGithubEventDocument> {
  for await (const rawEvent of rawEvents) {
    yield transformEvent(rawEvent, importId);
  }
}

function buildBatchStream(
  filePath: string,
  importId: string,
  options: IProcessArchiveOptions,
  onInvalidLine: OnInvalidLine,
): AsyncGenerator<IGithubEventDocument[]> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename, @typescript-eslint/no-unsafe-assignment -- filePath comes from the download/upload flow's validated storage path, never raw external input; Node's stream typings do not genericize Readable async iteration, so compose's result types as any, but the explicit annotation still gives every downstream usage a real, checked type.
  const archiveStream: AsyncIterable<Buffer> = createReadStream(filePath).compose(createGunzip());
  const bounded = limitDecompressedBytes(archiveStream, options.maxDecompressedBytes);
  const lines = splitLines(bounded, options.maxLineBytes);
  const rawEvents = parseAndValidate(lines, onInvalidLine);
  const documents = transformEvents(rawEvents, importId);

  return batchEvents(documents, options.batchSize);
}

export async function processArchive(
  filePath: string,
  importId: string,
  options: IProcessArchiveOptions,
  onInvalidLine?: OnInvalidLine,
  onBatchErrors?: OnBatchErrors,
): Promise<ImportResult> {
  const counters = new ImportCounters();

  try {
    const batches = buildBatchStream(filePath, importId, options, (rawLine, error) => {
      counters.recordInvalidLine();
      onInvalidLine?.(rawLine, error);
    });

    await insertBatches({
      batches,
      concurrency: options.insertConcurrency,
      insert: (batch) => insertBatch(options.collection, batch),
      onResult: (result) => {
        counters.recordBatch(result);

        if (result.errorCount > 0) {
          onBatchErrors?.(result.errorCount, result.errorSample);
        }
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    const cause = error instanceof Error ? error : undefined;

    throw new ArchiveProcessingError(
      `Archive processing failed: ${error instanceof Error ? error.message : String(error)}`,
      importId,
      filePath,
      cause,
    );
  }

  return counters.toResult();
}
