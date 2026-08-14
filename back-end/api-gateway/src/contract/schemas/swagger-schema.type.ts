import { type ApiResponseSchemaHost } from '@nestjs/swagger';

// zod's z.toJSONSchema() return type isn't structurally identical to
// @nestjs/swagger's SchemaObject (recursive `not`/`allOf` typing differs),
// so it needs an explicit cast at this doc-generation boundary only — the
// runtime contract enforcement (ContractValidationInterceptor) is unaffected.
export type SwaggerSchema = ApiResponseSchemaHost['schema'];
