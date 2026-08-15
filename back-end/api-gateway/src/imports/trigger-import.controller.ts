import { randomUUID } from 'node:crypto';

import { Controller, Headers, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { type ClientProxy } from '@nestjs/microservices';
import { ApiBody, ApiHeader, ApiTags } from '@nestjs/swagger';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/logger.service';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';
import { ContextPropagatingClient } from '@task1/shared/request-context/rmq/context-propagating.client';
import { z } from 'zod';

import { ApiSingleResponse } from '../contract/decorators/api-envelope-response.decorator.js';
import { Contract } from '../contract/decorators/contract.decorator.js';
import { type BoundRequest, ModelBinder } from '../contract/decorators/model-binder.decorator.js';
import { toSwaggerSchema } from '../contract/schemas/swagger-schema.js';
import { SERVICE_A_RMQ_CLIENT } from '../rmq/rmq-client.tokens.js';

import { InvalidIdempotencyKeyError } from './errors.js';
import { TriggerImportRequestSchema } from './schemas/trigger-import-request.schema.js';
import { TriggerImportResponseSchema } from './schemas/trigger-import-response.schema.js';

const PUBLISH_FAILED_LOG = 'Failed to publish message to service-a';

function isValidIdempotencyKey(value: string): boolean {
  return z.string().uuid().safeParse(value).success;
}

@ApiTags('imports')
@Controller('imports')
export class TriggerImportController {
  public constructor(
    @Inject(SERVICE_A_RMQ_CLIENT) private readonly serviceAClient: ClientProxy,
    private readonly propagatingClient: ContextPropagatingClient,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger(TriggerImportController.name);
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Contract({ request: TriggerImportRequestSchema, response: TriggerImportResponseSchema })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Client-supplied UUID. Replaying the same key returns the same importId and does not start a second import.',
  })
  @ApiBody({ schema: toSwaggerSchema(TriggerImportRequestSchema.shape.body) })
  @ApiSingleResponse(TriggerImportResponseSchema, { status: HttpStatus.ACCEPTED })
  public trigger(
    @ModelBinder(TriggerImportRequestSchema)
    bound: BoundRequest<typeof TriggerImportRequestSchema>,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): { importId: string } {
    if (idempotencyKey !== undefined && !isValidIdempotencyKey(idempotencyKey)) {
      throw new InvalidIdempotencyKeyError(idempotencyKey);
    }

    const importId = idempotencyKey ?? randomUUID();

    this.publish(RPC_PATTERNS.ARCHIVE_IMPORT_DOWNLOAD, {
      importId,
      dateHour: bound.data.dateHour,
    });

    return { importId };
  }

  private readonly logger: AppLogger;

  private publish(pattern: string, payload: Record<string, unknown>): void {
    this.propagatingClient.emit(this.serviceAClient, pattern, payload).subscribe({
      error: (error: unknown) => {
        this.logger.error({ pattern }, PUBLISH_FAILED_LOG, error);
      },
    });
  }
}
