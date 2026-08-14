import { TriggerImportRequestSchema } from './trigger-import-request.schema.js';

describe('TriggerImportRequestSchema', () => {
  it('should accept a well-formed dateHour, when parsed', () => {
    const result = TriggerImportRequestSchema.safeParse({ body: { dateHour: '2026-08-11-0' } });

    expect(result.success).toBe(true);
  });

  it('should reject a dateHour that does not match YYYY-MM-DD-H, when parsed', () => {
    const result = TriggerImportRequestSchema.safeParse({ body: { dateHour: 'not-a-date-hour' } });

    expect(result.success).toBe(false);
  });

  it('should reject a missing body, when parsed', () => {
    const result = TriggerImportRequestSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it('should reject an unexpected body key, when parsed', () => {
    const result = TriggerImportRequestSchema.safeParse({
      body: { dateHour: '2026-08-11-0', unexpected: 'value' },
    });

    expect(result.success).toBe(false);
  });
});
