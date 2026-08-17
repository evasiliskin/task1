import { listResult } from '../pagination/list-result.js';

import { buildSuccessEnvelope } from './success-envelope.utility.js';

const CORRELATION_ID = '2f1fdc5d-4324-4f56-95ae-d25df842bd7b';

describe('buildSuccessEnvelope', () => {
  it('should wrap a plain object in result.data, when the payload is not a list result', () => {
    const envelope = buildSuccessEnvelope(
      { importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
      CORRELATION_ID,
      200,
    );

    expect(envelope).toEqual({
      status: 'SUCCESS',
      code: 200,
      message: 'OK',
      result: { data: { importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' } },
      meta: { tracing: { correlationId: CORRELATION_ID } },
    });
  });

  it('should wrap items and pagination in result, when the payload is a list result', () => {
    const payload = listResult([{ id: '1' }], { nextCursor: 'abc' });

    const envelope = buildSuccessEnvelope(payload, CORRELATION_ID, 200);

    expect(envelope.result).toEqual({ items: [{ id: '1' }], pagination: { nextCursor: 'abc' } });
  });

  it('should report the given status code, when the handler set a non-200 status', () => {
    const envelope = buildSuccessEnvelope({ status: 'degraded' }, CORRELATION_ID, 503);

    expect(envelope.code).toBe(503);
    expect(envelope.status).toBe('SUCCESS');
  });

  it('should wrap a bare array in result.data, when the payload is an unbranded array', () => {
    const envelope = buildSuccessEnvelope([1, 2], CORRELATION_ID, 200);

    expect(envelope.result).toEqual({ data: [1, 2] });
  });
});
