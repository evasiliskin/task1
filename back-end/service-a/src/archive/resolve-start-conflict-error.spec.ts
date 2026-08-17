import { ImportAlreadyClaimedError } from './import-claim.error.js';
import { ImportRunInProgressError } from './import-run-in-progress.error.js';
import { resolveStartConflictError } from './resolve-start-conflict-error.js';

const IMPORT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

describe('resolveStartConflictError', () => {
  it('should return ImportAlreadyClaimedError, when a fresh delivery collides with an existing run', () => {
    expect(resolveStartConflictError(IMPORT_ID, 'fresh', 'started')).toBeInstanceOf(
      ImportAlreadyClaimedError,
    );
  });

  it('should return ImportAlreadyClaimedError, when a redelivery collides with an already-completed run', () => {
    expect(resolveStartConflictError(IMPORT_ID, 'redelivery', 'completed')).toBeInstanceOf(
      ImportAlreadyClaimedError,
    );
  });

  it('should return ImportAlreadyClaimedError, when a retry collides with an already-completed run', () => {
    expect(resolveStartConflictError(IMPORT_ID, 'retry', 'completed')).toBeInstanceOf(
      ImportAlreadyClaimedError,
    );
  });

  it('should return ImportRunInProgressError, when a redelivery collides with a run another consumer still holds', () => {
    expect(resolveStartConflictError(IMPORT_ID, 'redelivery', 'started')).toBeInstanceOf(
      ImportRunInProgressError,
    );
  });

  it('should return ImportRunInProgressError, when a retry collides with a run another consumer still holds', () => {
    expect(resolveStartConflictError(IMPORT_ID, 'retry', 'started')).toBeInstanceOf(
      ImportRunInProgressError,
    );
  });

  it('should return ImportRunInProgressError, when the conflicting run can no longer be read back', () => {
    expect(resolveStartConflictError(IMPORT_ID, 'redelivery', undefined)).toBeInstanceOf(
      ImportRunInProgressError,
    );
  });

  it('should carry the importId, when a conflict is resolved', () => {
    expect(resolveStartConflictError(IMPORT_ID, 'redelivery', 'completed').message).toContain(
      IMPORT_ID,
    );
  });
});
