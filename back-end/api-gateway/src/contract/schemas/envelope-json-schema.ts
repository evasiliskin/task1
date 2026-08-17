import { type ApiResponseSchemaHost } from '@nestjs/swagger';

type SchemaObject = ApiResponseSchemaHost['schema'];

const META_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    tracing: {
      type: 'object',
      properties: { correlationId: { type: 'string', format: 'uuid' } },
      required: ['correlationId'],
    },
  },
  required: ['tracing'],
};

function envelope(result: SchemaObject): SchemaObject {
  return {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['SUCCESS'] },
      code: { type: 'number', example: 200 },
      message: { type: 'string', example: 'OK' },
      result,
      meta: META_SCHEMA,
    },
    required: ['status', 'code', 'message', 'result', 'meta'],
  };
}

export function singleEnvelopeJsonSchema(dataSchema: SchemaObject): SchemaObject {
  return envelope({
    type: 'object',
    properties: { data: dataSchema },
    required: ['data'],
  });
}

export function listEnvelopeJsonSchema(listShape: SchemaObject): SchemaObject {
  return envelope(listShape);
}
