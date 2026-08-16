import { randomUUID } from 'node:crypto';

import { Controller, Headers, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { ApiBody, ApiHeader, ApiTags } from '@nestjs/swagger';
import { MessagePublishFailedError } from '@task1/shared/errors/index';
import { type IImportClaimView } from '@task1/shared/github-archive/index';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';
import { ContextPropagatingClient } from '@task1/shared/request-context/rmq/context-propagating.client';
import { firstValueFrom, timeout } from 'rxjs';
import { z } from 'zod';

import rabbitmqConfig from '../config/rabbitmq.config.js';
import { ApiSingleResponse } from '../contract/decorators/api-envelope-response.decorator.js';
import { Contract } from '../contract/decorators/contract.decorator.js';
import { type BoundRequest, ModelBinder } from '../contract/decorators/model-binder.decorator.js';
import { toSwaggerSchema } from '../contract/schemas/swagger-schema.js';
import { publishImportMessage } from '../rmq/publish-import-message.js';
import { SERVICE_A_IMPORTS_RMQ_CLIENT, SERVICE_A_RMQ_CLIENT } from '../rmq/rmq-client.tokens.js';

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
  @ApiBody({ schema: toSwaggerSchema(TriggerImportRequestSchema.shape.body) })
  @ApiSingleResponse(TriggerImportResponseSchema, { status: HttpStatus.ACCEPTED })
  public async trigger(
    @ModelBinder(TriggerImportRequestSchema)
    bound: BoundRequest<typeof TriggerImportRequestSchema>,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<{ importId: string }> {
    if (idempotencyKey !== undefined && !isValidIdempotencyKey(idempotencyKey)) {
      throw new InvalidIdempotencyKeyError(idempotencyKey);
    }

    const { importId } = await this.resolveImportId(idempotencyKey);

    // Published on every request, replays included. Suppressing it here would look tidier and break
    // recovery: a first request whose publish failed with 503 would leave a claim that silences the
    // retry forever. service-a's recordStarted already turns a duplicate into a benign skip.
    await publishImportMessage({
      propagatingClient: this.propagatingClient,
      client: this.serviceAImportsClient,
      pattern: RPC_PATTERNS.ARCHIVE_IMPORT_DOWNLOAD,
      payload: { importId, dateHour: bound.data.dateHour },
    });

    return { importId };
  }

  /**
   * The importId is always ours, never the caller's.
   *
   * Without a key there is nothing to deduplicate against, so one is generated locally and no round
   * trip is spent. With a key, service-a — which owns the `imports` collection — resolves it, which
   * is what keeps "same key, same importId" true without letting the client pick the id.
   */
  private async resolveImportId(idempotencyKey?: string): Promise<IImportClaimView> {
    if (idempotencyKey === undefined) {
      return { importId: randomUUID() };
    }

    try {
      return await firstValueFrom(
        this.propagatingClient
          .send<IImportClaimView>(this.serviceAClient, RPC_PATTERNS.IMPORTS_CLAIM, {
            idempotencyKey,
          })
          .pipe(timeout(this.rabbitmqConfiguration.rpcTimeoutMs)),
      );
    } catch (error) {
      // Mirrors publishImportMessage's own catch/rethrow below: both failure legs of this handler
      // — the claim RPC and the publish — must report identically (503, same error contract), since
      // from the caller's point of view a broker/service-a outage looks the same either way.
      throw new MessagePublishFailedError(RPC_PATTERNS.IMPORTS_CLAIM, error);
    }
  }
}
