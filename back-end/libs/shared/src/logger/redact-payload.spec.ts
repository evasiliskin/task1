import { REDACT_CENSOR } from './redact-paths.js';
import { redactLogPayload } from './redact-payload.js';

describe('redactLogPayload', () => {
  it('should censor the value, when a sensitive key is at the top level', () => {
    const result = redactLogPayload({ password: 'hunter2' });

    expect(result).toEqual({ password: REDACT_CENSOR });
  });

  it('should censor the value, when a sensitive key is deeply nested', () => {
    const result = redactLogPayload({ body: { credentials: { apiKey: 'gha-1' } } });

    expect(result).toEqual({ body: { credentials: { apiKey: REDACT_CENSOR } } });
  });

  it('should censor the value, when a sensitive key differs only in casing', () => {
    const result = redactLogPayload({ headers: { Authorization: 'Bearer gha-1' } });

    expect(result).toEqual({ headers: { Authorization: REDACT_CENSOR } });
  });

  it('should censor the value, when a sensitive key sits inside an array', () => {
    const result = redactLogPayload({ items: [{ secret: 'gha-1' }, { name: 'ok' }] });

    expect(result).toEqual({ items: [{ secret: REDACT_CENSOR }, { name: 'ok' }] });
  });

  it('should return an equal payload, when no key is sensitive', () => {
    const payload = { method: 'GET', statusCode: 200, tags: ['a', 'b'], nested: { count: 1 } };

    const result = redactLogPayload(payload);

    expect(result).toEqual(payload);
  });

  it('should leave the input untouched, when it contains a sensitive key', () => {
    const payload = { body: { password: 'hunter2' } };

    redactLogPayload(payload);

    expect(payload).toEqual({ body: { password: 'hunter2' } });
  });

  it('should replace the reference with a placeholder, when the payload is circular', () => {
    const payload: Record<string, unknown> = { name: 'root' };
    payload.self = payload;

    const result = redactLogPayload(payload);

    expect(result).toEqual({ name: 'root', self: '[Circular]' });
  });

  it('should stop descending, when the payload nests deeper than the maximum depth', () => {
    let payload: Record<string, unknown> = { leaf: true };

    for (let index = 0; index < 12; index += 1) {
      payload = { nested: payload };
    }

    const result = redactLogPayload(payload);

    expect(JSON.stringify(result)).toContain('[MaxDepthExceeded]');
  });

  it('should return the value as is, when it is null', () => {
    expect(redactLogPayload(null)).toBeNull();
  });

  it('should return the value as is, when it is undefined', () => {
    expect(redactLogPayload(undefined)).toBeUndefined();
  });

  it('should censor the value, when the object has a null prototype, as the query parser produces', () => {
    const query = Object.assign(Object.create(null) as Record<string, unknown>, {
      limit: '10',
      token: 'gha-1',
    });

    const result = redactLogPayload(query);

    expect(result).toEqual({ limit: '10', token: REDACT_CENSOR });
  });
});
