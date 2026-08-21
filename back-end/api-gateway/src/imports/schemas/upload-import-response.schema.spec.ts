import { UploadImportResponseSchema } from './upload-import-response.schema.js';

describe('UploadImportResponseSchema', () => {
  it('should accept a payload with a uuid importId, when parsed', () => {
    const result = UploadImportResponseSchema.safeParse({
      importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    });

    expect(result.success).toBe(true);
  });

  it('should reject a payload whose importId is not a uuid, when parsed', () => {
    const result = UploadImportResponseSchema.safeParse({ importId: 'not-a-uuid' });

    expect(result.success).toBe(false);
  });
});
