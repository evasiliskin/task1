import { randomUUID } from 'node:crypto';

import { Controller, Headers, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { ApiBody, ApiHeader, ApiTags } from '@nestjs/swagger';
import { type IImportClaimView } from '@task1/shared/github-archive/index';
import { COMMAND_PATTERNS } from '@task1/shared/messaging/command-patterns.const';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';
import { ContextPropagatingClient } from '@task1/shared/request-context/rmq/context-propagating.client';
import { z } from 'zod';

import rabbitmqConfig from '../config/rabbitmq.config.js';
import { ApiSingleResponse } from '../contract/decorators/api-envelope-response.decorator.js';
import { Contract } from '../contract/decorators/contract.decorator.js';
import { type BoundRequest, ModelBinder } from '../contract/decorators/model-binder.decorator.js';
import { toSwaggerSchema } from '../contract/schemas/swagger-schema.js';
import { publishImportMessage } from '../rmq/publish-import-message.js';
import { SERVICE_A_IMPORTS_RMQ_CLIENT, SERVICE_A_RMQ_CLIENT } from '../rmq/rmq-client.tokens.js';
import { sendRpcMessage } from '../rmq/send-rpc-message.js';

import { InvalidIdempotencyKeyError } from './errors.js';
import { TriggerImportRequestSchema } from './schemas/trigger-import-request.schema.js';
import { TriggerImportResponseSchema } from './schemas/trigger-import-response.schema.js';

function isValidIdempotencyKey(value: string): boolean {
  return z.string().uuid().safeParse(value).success;
}

@ApiTags('imports')
@Controller('imports')
export class TriggerImportController {
  public constructor(
    @Inject(SERVICE_A_IMPORTS_RMQ_CLIENT) private readonly serviceAImportsClient: ClientProxy,
    @Inject(SERVICE_A_RMQ_CLIENT) private readonly serviceAClient: ClientProxy,
    @Inject(rabbitmqConfig.KEY)
    private readonly rabbitmqConfiguration: ConfigType<typeof rabbitmqConfig>,
    private readonly propagatingClient: ContextPropagatingClient,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Contract({ request: TriggerImportRequestSchema, response: TriggerImportResponseSchema })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Client-supplied UUID. The returned importId is always server-generated — replaying the same key resolves to the same server-generated importId and does not start a second import.',
  })
  @ApiBody({
    schema: toSwaggerSchema(TriggerImportRequestSchema.shape.body),
    examples: {
      default: {
        summary: 'Single hour import',
        value: { dateHour: '2026-01-02-12' },
      },
    },
  })
  @ApiSingleResponse(TriggerImportResponseSchema, { status: HttpStatus.ACCEPTED })
  public async trigger(
    @ModelBinder(TriggerImportRequestSchema)
    bound: BoundRequest<typeof TriggerImportRequestSchema>,
    @Headers('Idempotency-Key') idempotencyKey?: string,
  ): Promise<{ importId: string }> {
    if (idempotencyKey !== undefined && !isValidIdempotencyKey(idempotencyKey)) {
      throw new InvalidIdempotencyKeyError(idempotencyKey);
    }

    const { importId } = await this.resolveImportId(idempotencyKey);

    await publishImportMessage({
      propagatingClient: this.propagatingClient,
      client: this.serviceAImportsClient,
      pattern: COMMAND_PATTERNS.ARCHIVE_IMPORT_DOWNLOAD,
      payload: { importId, dateHour: bound.data.dateHour },
      timeoutMs: this.rabbitmqConfiguration.rpcTimeoutMs,
    });

    return { importId };
  }

  private async resolveImportId(idempotencyKey?: string): Promise<IImportClaimView> {
    if (idempotencyKey === undefined) {
      return { importId: randomUUID() };
    }

    return await sendRpcMessage<IImportClaimView>({
      propagatingClient: this.propagatingClient,
      client: this.serviceAClient,
      pattern: RPC_PATTERNS.IMPORTS_CLAIM,
      payload: { idempotencyKey },
      timeoutMs: this.rabbitmqConfiguration.rpcTimeoutMs,
    });
  }
}
