import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection, type MongoBulkWriteError, type WriteError } from 'mongodb';

const DUPLICATE_KEY_ERROR_CODE = 11000;
/**
 * A failing batch usually fails the same way for every document. Sampling distinct failure modes
 * gives the reader the "why" that `errorCount` alone never could, without letting one bad archive
 * write a line per document.
 */
const MAX_ERROR_SAMPLE = 5;

export interface IWriteErrorSample {
  code: number;
  message: string;
}

export interface IInsertBatchResult {
  insertedCount: number;
  duplicateCount: number;
  errorCount: number;
  errorSample: readonly IWriteErrorSample[];
}

function isMongoBulkWriteError(error: unknown): error is MongoBulkWriteError {
  return error instanceof Error && error.name === 'MongoBulkWriteError';
}

function toErrorSample(writeErrors: readonly WriteError[]): IWriteErrorSample[] {
  const distinct = new Map<number, IWriteErrorSample>();

  for (const writeError of writeErrors) {
    if (!distinct.has(writeError.code)) {
      distinct.set(writeError.code, {
        code: writeError.code,
        message: writeError.errmsg ?? 'Unknown write error',
      });
    }
  }

  return [...distinct.values()].slice(0, MAX_ERROR_SAMPLE);
}

export async function insertBatch(
  collection: Collection<IGithubEventDocument>,
  batch: readonly IGithubEventDocument[],
): Promise<IInsertBatchResult> {
  if (batch.length === 0) {
    return { insertedCount: 0, duplicateCount: 0, errorCount: 0, errorSample: [] };
  }

  try {
    const result = await collection.insertMany(batch, { ordered: false });

    return {
      insertedCount: result.insertedCount,
      duplicateCount: 0,
      errorCount: 0,
      errorSample: [],
    };
  } catch (error) {
    if (!isMongoBulkWriteError(error)) {
      throw error;
    }

    const writeErrors: readonly WriteError[] = Array.isArray(error.writeErrors)
      ? error.writeErrors
      : [error.writeErrors];
    const otherErrors = writeErrors.filter(
      (writeError) => writeError.code !== DUPLICATE_KEY_ERROR_CODE,
    );

    return {
      insertedCount: error.insertedCount,
      duplicateCount: writeErrors.length - otherErrors.length,
      errorCount: otherErrors.length,
      errorSample: toErrorSample(otherErrors),
    };
  }
}
