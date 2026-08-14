import { type ApiResponseSchemaHost } from '@nestjs/swagger';
import { z, type ZodType } from 'zod';

export type SwaggerSchema = ApiResponseSchemaHost['schema'];

// zod's z.toJSONSchema() return type isn't structurally identical to
// @nestjs/swagger's SchemaObject (recursive `not`/`allOf` typing differs),
// so it needs an explicit cast. Keeping the cast in this one helper stops it
// from being repeated at every @Api*Response/@ApiBody call site — the runtime
// contract enforcement (ContractValidationInterceptor) is unaffected either way.
export function toSwaggerSchema(schema: ZodType): SwaggerSchema {
  return z.toJSONSchema(schema) as SwaggerSchema;
}
