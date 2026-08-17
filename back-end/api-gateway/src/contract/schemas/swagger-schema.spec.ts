import { z } from 'zod';

import { toSwaggerSchema } from './swagger-schema.js';

describe('toSwaggerSchema', () => {
  it('should convert a Zod object into a JSON schema, when given one', () => {
    const schema = toSwaggerSchema(z.object({ importId: z.string(), count: z.number() }));

    expect(schema).toMatchObject({
      type: 'object',
      properties: { importId: { type: 'string' }, count: { type: 'number' } },
    });
  });

  it('should mark optional fields as not required, when converting', () => {
    const schema = toSwaggerSchema(z.object({ cursor: z.string().optional() }));

    expect(schema.required).toBeUndefined();
  });
});
