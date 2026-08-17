import { resolveId, resolveIdWithSource } from './id-validation.util.js';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  it('should return a generated UUID v4, when the header is an overlong non-UUID string', () => {
    const result = resolveId('a'.repeat(201));

    expect(result).toMatch(UUID_V4_PATTERN);
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
  it('should report "inbound", when a valid UUID is supplied', () => {
    const resolved = resolveIdWithSource('11111111-1111-4111-8111-111111111111');

    expect(resolved).toEqual({
      value: '11111111-1111-4111-8111-111111111111',
      source: 'inbound',
    });
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

  it('should adopt the inbound value, when it is a well-formed UUID', () => {
    const resolved = resolveIdWithSource('f47ac10b-58cc-4372-a567-0e02b2c3d479');

    expect(resolved).toEqual({
      value: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      source: 'inbound',
    });
  });

  it.each([
    ['not-a-uuid'],
    ['f47ac10b58cc4372a5670e02b2c3d479'],
    ['f47ac10b-58cc-4372-a567-0e02b2c3d479-extra'],
    ['../../etc/passwd'],
    ['a'.repeat(200)],
  ])('should replace the inbound id with a generated one, when it is not a UUID (%s)', (raw) => {
    const resolved = resolveIdWithSource(raw);

    expect(resolved.source).toBe('generated');
    expect(resolved.value).not.toBe(raw);
    expect(resolved.value).toMatch(UUID_PATTERN);
  });
});
