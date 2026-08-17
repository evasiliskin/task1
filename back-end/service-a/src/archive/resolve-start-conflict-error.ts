import { ImportAlreadyClaimedError } from './import-claim.error.js';
import { type ImportDeliveryKind } from './import-delivery-kind.js';
import { ImportRunInProgressError } from './import-run-in-progress.error.js';
import { type ImportRunStatus } from './import-run.types.js';

export function resolveStartConflictError(
  importId: string,
  delivery: ImportDeliveryKind,
  status: ImportRunStatus | undefined,
): ImportAlreadyClaimedError | ImportRunInProgressError {
  if (delivery === 'fresh' || status === 'completed') {
    return new ImportAlreadyClaimedError(importId);
  }

  return new ImportRunInProgressError(importId);
}
