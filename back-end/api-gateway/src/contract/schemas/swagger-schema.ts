import { type ApiResponseSchemaHost } from '@nestjs/swagger';
import { z, type ZodType } from 'zod';

export type SwaggerSchema = ApiResponseSchemaHost['schema'];

export function toSwaggerSchema(schema: ZodType): SwaggerSchema {
  return z.toJSONSchema(schema) as SwaggerSchema;
}
