import { GetImportStatusRequestSchema } from './get-import-status-request.schema.js';

describe('GetImportStatusRequestSchema', () => {
  it('should accept a uuid importId param, when parsed', () => {
    const result = GetImportStatusRequestSchema.safeParse({
      params: { importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
    });

    expect(result.success).toBe(true);
  });

  it('should reject a non-uuid importId param, when parsed', () => {
    const result = GetImportStatusRequestSchema.safeParse({ params: { importId: 'not-a-uuid' } });

    expect(result.success).toBe(false);
  });
});
