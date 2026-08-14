import { type ApiResponseSchemaHost } from '@nestjs/swagger';
import { z } from 'zod';

import { listEnvelopeJsonSchema, singleEnvelopeJsonSchema } from './envelope-json-schema.js';
import { listResponseSchema } from './list-response.schema.js';

// zod's z.toJSONSchema() return type isn't structurally identical to
// @nestjs/swagger's SchemaObject (recursive `not`/`allOf` typing differs),
// so it needs an explicit cast at this doc-generation boundary only — the
// runtime contract enforcement (ContractValidationInterceptor) is unaffected.
type SwaggerSchema = ApiResponseSchemaHost['schema'];

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
