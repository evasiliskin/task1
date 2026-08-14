import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection, type MongoBulkWriteError, type WriteError } from 'mongodb';

const DUPLICATE_KEY_ERROR_CODE = 11000;

export interface IInsertBatchResult {
  insertedCount: number;
  duplicateCount: number;
  errorCount: number;
}

function isMongoBulkWriteError(error: unknown): error is MongoBulkWriteError {
  return error instanceof Error && error.name === 'MongoBulkWriteError';
}

export async function insertBatch(
  collection: Collection<IGithubEventDocument>,
  batch: readonly IGithubEventDocument[],
): Promise<IInsertBatchResult> {
  if (batch.length === 0) {
    return { insertedCount: 0, duplicateCount: 0, errorCount: 0 };
  }

  try {
    const result = await collection.insertMany(batch, { ordered: false });

    return { insertedCount: result.insertedCount, duplicateCount: 0, errorCount: 0 };
  } catch (error) {
    if (!isMongoBulkWriteError(error)) {
      throw error;
    }

    const writeErrors: readonly WriteError[] = Array.isArray(error.writeErrors)
      ? error.writeErrors
      : [error.writeErrors];
    const duplicateCount = writeErrors.filter(
      (writeError) => writeError.code === DUPLICATE_KEY_ERROR_CODE,
    ).length;

    return {
      insertedCount: error.insertedCount,
      duplicateCount,
      errorCount: writeErrors.length - duplicateCount,
    };
  }
}
