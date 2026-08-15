import { resolveId, resolveIdWithSource } from './id-validation.util.js';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('resolveId', () => {
  it('should return the trimmed value, when given a valid header value with surrounding whitespace', () => {
    const result = resolveId('  11111111-1111-4111-8111-111111111111  ');

    expect(result).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('should return a generated UUID v4, when the header is undefined', () => {
    const result = resolveId(undefined);

    expect(result).toMatch(UUID_V4_PATTERN);
  });

  it('should return a generated UUID v4, when the header is an empty string', () => {
    const result = resolveId('');

    expect(result).toMatch(UUID_V4_PATTERN);
  });

  it('should return a generated UUID v4, when the header is only whitespace', () => {
    const result = resolveId('   ');

    expect(result).toMatch(UUID_V4_PATTERN);
  });

  it('should return a generated UUID v4, when the header exceeds the max length', () => {
    const result = resolveId('a'.repeat(201));

    expect(result).toMatch(UUID_V4_PATTERN);
  });

  it('should accept a value at exactly the max length', () => {
    const value = 'a'.repeat(200);

    const result = resolveId(value);

    expect(result).toBe(value);
  });

  it('should return a generated UUID v4, when the header contains a control character', () => {
    const result = resolveId('bad\r\nvalue');

    expect(result).toMatch(UUID_V4_PATTERN);
  });

  it('should return a generated UUID v4, when the header contains a space', () => {
    const result = resolveId('has space');

    expect(result).toMatch(UUID_V4_PATTERN);
  });

  it('should use the first value, when the header arrives as an array (repeated header)', () => {
    const result = resolveId(['11111111-1111-4111-8111-111111111111', 'other-value']);

    expect(result).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('should return a generated UUID v4, when the header array is empty', () => {
    const result = resolveId([]);

    expect(result).toMatch(UUID_V4_PATTERN);
  });
});

describe('resolveIdWithSource', () => {
  it('should report "inbound", when a valid id is supplied', () => {
    const resolved = resolveIdWithSource('abc-123');

    expect(resolved).toEqual({ value: 'abc-123', source: 'inbound' });
  });

  it('should report "generated", when no id is supplied', () => {
    const resolved = resolveIdWithSource(undefined);

    expect(resolved.source).toBe('generated');
    expect(resolved.value).toHaveLength(36);
  });

  it('should report "generated", when the supplied id is rejected as unsafe', () => {
    const resolved = resolveIdWithSource('bad id\nwith newline');

    expect(resolved.source).toBe('generated');
  });
});
