import { HealthResponseSchema, LivenessResponseSchema } from './health-response.schema.js';

describe('HealthResponseSchema', () => {
  it('should accept a well-formed aggregated health payload, when parsed', () => {
    const result = HealthResponseSchema.safeParse({
      status: 'ok',
      services: {
        gateway: 'ok',
        rabbitmq: 'ok',
        serviceA: 'ok',
        serviceB: 'unavailable',
        redis: 'ok',
      },
    });

    expect(result.success).toBe(true);
  });

  it('should reject an unknown status value, when parsed', () => {
    const result = HealthResponseSchema.safeParse({
      status: 'unknown',
      services: {
        gateway: 'ok',
        rabbitmq: 'ok',
        serviceA: 'ok',
        serviceB: 'ok',
        redis: 'ok',
      },
    });

    expect(result.success).toBe(false);
  });
});

describe('LivenessResponseSchema', () => {
  it('should accept the fixed liveness payload, when parsed', () => {
    const result = LivenessResponseSchema.safeParse({ status: 'ok', service: 'gateway' });

    expect(result.success).toBe(true);
  });
});
