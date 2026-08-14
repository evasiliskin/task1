import { buildErrorEnvelope } from './error-envelope.utility.js';

const CORRELATION_ID = '2f1fdc5d-4324-4f56-95ae-d25df842bd7b';

describe('buildErrorEnvelope', () => {
  it('should map code to reason and omit details, when the error has no field errors', () => {
    const envelope = buildErrorEnvelope(
      404,
      { code: 'IMPORT_NOT_FOUND', message: 'Import run not found' },
      CORRELATION_ID,
    );

    expect(envelope).toEqual({
      status: 'FAILED',
      code: 404,
      reason: 'IMPORT_NOT_FOUND',
      message: 'Import run not found',
      meta: { tracing: { correlationId: CORRELATION_ID } },
    });
  });

  it('should expose field errors as details.checksFailed, when field errors are present', () => {
    const envelope = buildErrorEnvelope(
      400,
      {
        code: 'REQUEST_CONTRACT_VIOLATION',
        message: 'Request validation failed',
        fieldErrors: [
          { field: 'limit', errorType: 'TOO_BIG', message: 'Too big', constraints: { max: 200 } },
        ],
      },
      CORRELATION_ID,
    );

    expect(envelope.details).toEqual({
      checksFailed: [
        { field: 'limit', errorType: 'TOO_BIG', message: 'Too big', constraints: { max: 200 } },
      ],
    });
  });

  it('should sanitize the response, when the status code is 500', () => {
    const envelope = buildErrorEnvelope(
      500,
      { code: 'DATABASE_EXPLODED', message: 'connection string mongodb://user:pw@host failed' },
      CORRELATION_ID,
    );

    expect(envelope).toEqual({
      status: 'FAILED',
      code: 500,
      reason: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      meta: { tracing: { correlationId: CORRELATION_ID } },
    });
  });

  it('should sanitize the response, when the status code is 503', () => {
    const envelope = buildErrorEnvelope(
      503,
      { code: 'RMQ_TIMEOUT', message: 'service-a did not reply within 5000ms' },
      CORRELATION_ID,
    );

    expect(envelope.reason).toBe('INTERNAL_ERROR');
    expect(envelope.message).toBe('An unexpected error occurred');
    expect(envelope.details).toBeUndefined();
  });

  it('should omit details, when field errors is an empty array', () => {
    const envelope = buildErrorEnvelope(
      400,
      { code: 'REQUEST_CONTRACT_VIOLATION', message: 'Request validation failed', fieldErrors: [] },
      CORRELATION_ID,
    );

    expect(envelope.details).toBeUndefined();
  });
});
