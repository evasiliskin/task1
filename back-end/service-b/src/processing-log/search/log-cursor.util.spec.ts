import { InvalidCursorError } from './errors.js';
import { decodeLogCursor, encodeLogCursor } from './log-cursor.util.js';

describe('encodeLogCursor / decodeLogCursor', () => {
  it('should round-trip timestamp and id, when a cursor is encoded then decoded', () => {
    const cursor = {
      timestamp: new Date('2026-08-11T00:00:00.000Z'),
      id: '64b7f0c2f1a2b3c4d5e6f7a1',
    };

    const decoded = decodeLogCursor(encodeLogCursor(cursor));

    expect(decoded.timestamp.toISOString()).toBe(cursor.timestamp.toISOString());
    expect(decoded.id).toBe(cursor.id);
  });

  it('should throw InvalidCursorError, when the cursor does not decode to valid JSON', () => {
    expect(() => decodeLogCursor('not-a-valid-cursor')).toThrow(InvalidCursorError);
  });

  it('should throw InvalidCursorError, when the decoded payload is missing id', () => {
    const payload = Buffer.from(
      JSON.stringify({ timestamp: '2026-08-11T00:00:00.000Z' }),
      'utf8',
    ).toString('base64url');

    expect(() => decodeLogCursor(payload)).toThrow(InvalidCursorError);
  });

  it('should throw InvalidCursorError, when timestamp is not an ISO datetime string', () => {
    const payload = Buffer.from(
      JSON.stringify({ timestamp: 'not-a-date', id: '64b7f0c2f1a2b3c4d5e6f7a1' }),
      'utf8',
    ).toString('base64url');

    expect(() => decodeLogCursor(payload)).toThrow(InvalidCursorError);
  });

  it('should throw InvalidCursorError, when id is not a 24-character hex string', () => {
    const payload = Buffer.from(
      JSON.stringify({ timestamp: '2026-08-11T00:00:00.000Z', id: 'not-hex' }),
      'utf8',
    ).toString('base64url');

    expect(() => decodeLogCursor(payload)).toThrow(InvalidCursorError);
  });
});
