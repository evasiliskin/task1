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
  ])('should treat "%s" as sensitive', (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each(['dateHour', 'importId', 'passwordPolicyEnabled', 'tokenizer'])(
    'should not treat "%s" as sensitive',
    (key) => {
      expect(isSensitiveKey(key)).toBe(false);
    },
  );
});

describe('REDACT_PATHS', () => {
  it('should target the request shape this application actually logs', () => {
    expect(REDACT_PATHS).toContain('request.headers.authorization');
    expect(REDACT_PATHS).not.toContain('req.headers.authorization');
  });

  it('should include one-level wildcards for free-form payloads', () => {
    expect(REDACT_PATHS).toContain('*.password');
    expect(REDACT_PATHS).toContain('*.accessToken');
  });
});
