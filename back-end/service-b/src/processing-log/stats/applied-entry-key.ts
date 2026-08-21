import { type IProcessingLogDocument } from '../processing-log.types.js';

export function buildAppliedEntryKey(entry: IProcessingLogDocument): string {
  return `${entry.importId}:${entry.status}`;
}
