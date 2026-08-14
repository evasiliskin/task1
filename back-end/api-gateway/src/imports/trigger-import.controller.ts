import { randomUUID } from 'node:crypto';

import { Controller, Headers, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { type ClientProxy } from '@nestjs/microservices';
import {
  type ApiResponseSchemaHost,
  ApiAcceptedResponse,
  ApiBody,
  ApiHeader,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';

import { Contract } from '../contract/decorators/contract.decorator.js';
import { type BoundRequest, ModelBinder } from '../contract/decorators/model-binder.decorator.js';
import { singleEnvelopeJsonSchema } from '../contract/schemas/envelope-json-schema.js';

import { InvalidIdempotencyKeyError } from './errors.js';
import { SERVICE_A_RMQ_CLIENT } from './rabbitmq-client.token.js';
import { TriggerImportRequestSchema } from './schemas/trigger-import-request.schema.js';
import { TriggerImportResponseSchema } from './schemas/trigger-import-response.schema.js';

const ARCHIVE_IMPORT_DOWNLOAD_PATTERN = 'archive.import.download';

// zod's z.toJSONSchema() return type isn't structurally identical to
// @nestjs/swagger's SchemaObject (recursive `not`/`allOf` typing differs),
// so it needs an explicit cast at this doc-generation boundary only — the
// runtime contract enforcement (ContractValidationInterceptor) is unaffected.
type SwaggerSchema = ApiResponseSchemaHost['schema'];

function isValidIdempotencyKey(value: string): boolean {
  return z.string().uuid().safeParse(value).success;
}

@ApiTags('imports')
@Controller('imports')
export class TriggerImportController {
  public constructor(@Inject(SERVICE_A_RMQ_CLIENT) private readonly serviceAClient: ClientProxy) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Contract({ request: TriggerImportRequestSchema, response: TriggerImportResponseSchema })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Client-supplied UUID. Replaying the same key returns the same importId and does not start a second import.',
  })
  @ApiBody({ schema: z.toJSONSchema(TriggerImportRequestSchema.shape.body) as SwaggerSchema })
  @ApiAcceptedResponse({
    schema: singleEnvelopeJsonSchema(z.toJSONSchema(TriggerImportResponseSchema) as SwaggerSchema),
  })
  public trigger(
    @ModelBinder(TriggerImportRequestSchema)
    bound: BoundRequest<typeof TriggerImportRequestSchema>,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): { importId: string } {
    if (idempotencyKey !== undefined && !isValidIdempotencyKey(idempotencyKey)) {
      throw new InvalidIdempotencyKeyError(idempotencyKey);
    }

    const importId = idempotencyKey ?? randomUUID();

    this.serviceAClient.emit(ARCHIVE_IMPORT_DOWNLOAD_PATTERN, {
      importId,
      dateHour: bound.data.dateHour,
    });

    return { importId };
  }
}
