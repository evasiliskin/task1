import { ObjectId } from 'mongodb';

import { toLogView } from './to-log-view.js';

const DOCUMENT = {
  _id: new ObjectId('64b7f3c2a1b2c3d4e5f60718'),
  importId: '11111111-1111-4111-8111-111111111111',
  eventType: 'github.import.completed',
  service: 'service-a' as const,
  status: 'completed' as const,
  timestamp: new Date('2026-08-11T00:00:00.000Z'),
  correlationId: '22222222-2222-4222-8222-222222222222',
  archive: '2026-08-11-0.json.gz',
  metadata: { eventsProcessed: 100 },
};

describe('toLogView', () => {
  it('should serialise timestamp as an ISO string', () => {
    expect(toLogView(DOCUMENT).timestamp).toBe('2026-08-11T00:00:00.000Z');
  });

  it('should not leak the Mongo _id onto the wire', () => {
    expect(toLogView(DOCUMENT)).not.toHaveProperty('_id');
  });

  it('should include errorInfo only when present', () => {
    expect(toLogView(DOCUMENT)).not.toHaveProperty('errorInfo');
    expect(toLogView({ ...DOCUMENT, errorInfo: { reason: 'boom' } })).toHaveProperty('errorInfo', {
      reason: 'boom',
    });
  });
});
