import { isSensitiveKey, REDACT_PATHS } from './redact-paths.js';

describe('isSensitiveKey', () => {
  it.each([
    'password',
    'Password',
    'apiKey',
    'api_key',
    'x-api-key',
    'X-API-KEY',
    'authorization',
    'proxy-authorization',
    'refreshToken',
    'clientSecret',
    'privateKey',
    'sessionId',
  ])('should report the key as sensitive, when the key is "%s"', (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each(['dateHour', 'importId', 'passwordPolicyEnabled', 'tokenizer'])(
    'should report the key as not sensitive, when the key is "%s"',
    (key) => {
      expect(isSensitiveKey(key)).toBe(false);
    },
  );
});

describe('REDACT_PATHS', () => {
  it('should cover the logged request shape, when the paths are inspected', () => {
    expect(REDACT_PATHS).toContain('request.headers.authorization');
    expect(REDACT_PATHS).not.toContain('req.headers.authorization');
  });

  it('should include one-level wildcards, when the paths are inspected', () => {
    expect(REDACT_PATHS).toContain('*.password');
    expect(REDACT_PATHS).toContain('*.accessToken');
  });
});
