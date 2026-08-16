import { InvalidCursorError } from '@task1/shared';

import { decodeEventCursor, encodeEventCursor } from './event-cursor.util.js';

describe('encodeEventCursor / decodeEventCursor', () => {
  it('should round-trip createdAt and eventId, when a cursor is encoded then decoded', () => {
    const cursor = { createdAt: new Date('2026-08-11T00:00:00.000Z'), eventId: 'e1' };

    const decoded = decodeEventCursor(encodeEventCursor(cursor));

    expect(decoded.createdAt.toISOString()).toBe(cursor.createdAt.toISOString());
    expect(decoded.eventId).toBe(cursor.eventId);
  });

  it('should throw InvalidCursorError, when the cursor does not decode to valid JSON', () => {
    expect(() => decodeEventCursor('not-a-valid-cursor')).toThrow(InvalidCursorError);
  });

  it('should throw InvalidCursorError, when the decoded payload is missing eventId', () => {
    const payload = Buffer.from(
      JSON.stringify({ createdAt: '2026-08-11T00:00:00.000Z' }),
      'utf8',
    ).toString('base64url');

    expect(() => decodeEventCursor(payload)).toThrow(InvalidCursorError);
  });

  it('should throw InvalidCursorError, when createdAt is not an ISO datetime string', () => {
    const payload = Buffer.from(
      JSON.stringify({ createdAt: 'not-a-date', eventId: 'e1' }),
      'utf8',
    ).toString('base64url');

    expect(() => decodeEventCursor(payload)).toThrow(InvalidCursorError);
  });
});
