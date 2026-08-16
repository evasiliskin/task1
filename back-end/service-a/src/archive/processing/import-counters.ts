import { type IInsertBatchResult } from './insert-batch.js';
import { type ImportResult } from './process-archive.js';

/**
 * The single owner of an import's tallies.
 *
 * Previously four `let` variables in `processArchive`, incremented from two places — a callback
 * closure defined mid-pipeline and the consumer loop below it. Keeping the four together makes the
 * `eventsProcessed` identity checkable in one place instead of three.
 */
export class ImportCounters {
  public recordInvalidLine(): void {
    this.invalidEvents += 1;
  }

  public recordBatch(result: IInsertBatchResult): void {
    this.validEvents += result.insertedCount;
    this.duplicateEvents += result.duplicateCount;
    this.errorCount += result.errorCount;
  }

  public toResult(): ImportResult {
    return {
      eventsProcessed:
        this.invalidEvents + this.validEvents + this.duplicateEvents + this.errorCount,
      validEvents: this.validEvents,
      invalidEvents: this.invalidEvents,
      duplicateEvents: this.duplicateEvents,
      errorCount: this.errorCount,
    };
  }

  private invalidEvents = 0;

  private validEvents = 0;

  private duplicateEvents = 0;

  private errorCount = 0;
}
