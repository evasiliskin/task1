import { z } from 'zod';

import { listEnvelopeJsonSchema, singleEnvelopeJsonSchema } from './envelope-json-schema.js';
import { listResponseSchema } from './list-response.schema.js';
import { type SwaggerSchema } from './swagger-schema.js';

describe('singleEnvelopeJsonSchema', () => {
  it('should nest the payload under result.data, when wrapping a single schema', () => {
    const wrapped = singleEnvelopeJsonSchema(
      z.toJSONSchema(z.object({ importId: z.string() })) as SwaggerSchema,
    );

    expect(wrapped.properties?.result).toMatchObject({
      properties: { data: { properties: { importId: { type: 'string' } } } },
    });
  });

  it('should declare the envelope fields as required, when wrapping a schema', () => {
    const wrapped = singleEnvelopeJsonSchema(z.toJSONSchema(z.object({})) as SwaggerSchema);

    expect(wrapped.required).toEqual(['status', 'code', 'message', 'result', 'meta']);
  });
});

describe('listEnvelopeJsonSchema', () => {
  it('should place items and pagination under result, when wrapping a list shape', () => {
    const { shape } = listResponseSchema(z.object({ id: z.string() }));

    const wrapped = listEnvelopeJsonSchema(z.toJSONSchema(shape) as SwaggerSchema);

    expect(wrapped.properties?.result).toMatchObject({
      properties: { items: { type: 'array' }, pagination: { type: 'object' } },
    });
  });
});
