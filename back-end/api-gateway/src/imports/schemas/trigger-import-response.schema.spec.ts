import { TriggerImportResponseSchema } from './trigger-import-response.schema.js';

describe('TriggerImportResponseSchema', () => {
  it('should accept a payload with a uuid importId, when parsed', () => {
    const result = TriggerImportResponseSchema.safeParse({
      importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    });

    expect(result.success).toBe(true);
  });
});
