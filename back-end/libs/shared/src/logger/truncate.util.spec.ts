import { truncateForLog } from './truncate.util.js';

describe('truncateForLog', () => {
  it('should return the value unchanged, when it is under the cap', () => {
    expect(truncateForLog({ dateHour: '2026-08-11-0' }, 1024)).toEqual({
      dateHour: '2026-08-11-0',
    });
  });

  it('should replace the value with a marker, when it exceeds the cap', () => {
    const large = { blob: 'x'.repeat(5000) };

    expect(truncateForLog(large, 1024)).toEqual({
      truncated: true,
      approximateBytes: expect.any(Number) as number,
    });
  });

  it('should return undefined, when the value is undefined', () => {
    expect(truncateForLog(undefined, 1024)).toBeUndefined();
  });

  it('should return the value unchanged, when it cannot be JSON-serialized', () => {
    function unserializable(): void {
      /* no-op: a function value is what JSON.stringify cannot serialize */
    }

    expect(truncateForLog(unserializable, 1024)).toBe(unserializable);
  });
});
