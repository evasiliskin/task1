import { EmptyRequestSchema } from './empty.schema.js';

describe('EmptyRequestSchema', () => {
  it('should accept an empty object, when parsed', () => {
    const result = EmptyRequestSchema.safeParse({});

    expect(result.success).toBe(true);
  });

  it('should reject an object with unexpected keys, when parsed', () => {
    const result = EmptyRequestSchema.safeParse({ unexpected: 'value' });

    expect(result.success).toBe(false);
  });
});
