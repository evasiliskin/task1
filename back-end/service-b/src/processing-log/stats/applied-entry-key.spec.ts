import { type IProcessingLogDocument } from '../processing-log.types.js';

import { buildAppliedEntryKey } from './applied-entry-key.js';

function buildEntry(
  importId: string,
  status: IProcessingLogDocument['status'],
): IProcessingLogDocument {
  return {
    importId,
    eventType: `github.import.${status}`,
    service: 'service-a',
    status,
    timestamp: new Date('2026-08-11T00:00:00Z'),
    correlationId: '8f14e45f-ceea-4e0a-9d1b-3a2e6f7c8b90',
    archive: '2026-08-11-0.json.gz',
    metadata: {},
  };
}

describe('buildAppliedEntryKey', () => {
  it('should return the same key, when the same entry is rebuilt after a redelivery', () => {
    const first = buildEntry('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'completed');
    const second = buildEntry('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'completed');

    expect(buildAppliedEntryKey(first)).toBe(buildAppliedEntryKey(second));
  });

  it('should return distinct keys, when the same import reports different statuses', () => {
    const completed = buildEntry('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'completed');
    const failed = buildEntry('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'failed');

    expect(buildAppliedEntryKey(completed)).not.toBe(buildAppliedEntryKey(failed));
  });

  it('should return distinct keys, when different imports report the same status', () => {
    const first = buildEntry('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'completed');
    const second = buildEntry('f47ac10b-58cc-4372-a567-0e02b2c3d479', 'completed');

    expect(buildAppliedEntryKey(first)).not.toBe(buildAppliedEntryKey(second));
  });
});
