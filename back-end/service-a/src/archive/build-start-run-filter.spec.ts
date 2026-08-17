import { buildReopenRunFilter, buildStartRunFilter } from './build-start-run-filter.js';

const IMPORT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const STALE_BEFORE = new Date('2026-08-11T00:00:00Z');

describe('buildStartRunFilter', () => {
  it('should require the run to have no startedAt, when a run is started for the first time', () => {
    expect(buildStartRunFilter(IMPORT_ID)).toEqual({
      importId: IMPORT_ID,
      startedAt: { $exists: false },
    });
  });
});

describe('buildReopenRunFilter', () => {
  it('should return undefined, when the delivery is fresh', () => {
    expect(buildReopenRunFilter(IMPORT_ID, 'fresh', STALE_BEFORE)).toBeUndefined();
  });

  it('should only match a settled or stale run, when the delivery is a republished retry', () => {
    expect(buildReopenRunFilter(IMPORT_ID, 'retry', STALE_BEFORE)).toEqual({
      importId: IMPORT_ID,
      startedAt: { $exists: true },
      $or: [{ status: { $ne: 'started' } }, { startedAt: { $lt: STALE_BEFORE } }],
    });
  });

  it('should match any started run, when the broker redelivered the same message', () => {
    expect(buildReopenRunFilter(IMPORT_ID, 'redelivery', STALE_BEFORE)).toEqual({
      importId: IMPORT_ID,
      startedAt: { $exists: true },
    });
  });
});
