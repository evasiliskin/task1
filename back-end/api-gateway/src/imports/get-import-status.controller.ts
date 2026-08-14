import { Controller, Get, Inject } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';
import { buildOutboundHeaders } from '@task1/shared/request-context/propagation.util';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { firstValueFrom, timeout } from 'rxjs';
import { z } from 'zod';

import rabbitmqConfig from '../config/rabbitmq.config.js';
import { Contract } from '../contract/decorators/contract.decorator.js';
import { type BoundRequest, ModelBinder } from '../contract/decorators/model-binder.decorator.js';
import { singleEnvelopeJsonSchema } from '../contract/schemas/envelope-json-schema.js';
import { type SwaggerSchema } from '../contract/schemas/swagger-schema.type.js';
import { SERVICE_A_RMQ_CLIENT } from '../rmq/rmq-client.tokens.js';

import { ImportNotFoundError } from './errors.js';
import { GetImportStatusRequestSchema } from './schemas/get-import-status-request.schema.js';
import {
  type ImportStatusResponse,
  ImportStatusResponseSchema,
} from './schemas/import-status-response.schema.js';

@ApiTags('imports')
@Controller('imports')
export class GetImportStatusController {
  public constructor(
    @Inject(SERVICE_A_RMQ_CLIENT) private readonly serviceAClient: ClientProxy,
    private readonly requestContextService: RequestContextService,
    @Inject(rabbitmqConfig.KEY)
    private readonly rabbitmqConfiguration: ConfigType<typeof rabbitmqConfig>,
  ) {}

  @Get(':importId')
  @Contract({ request: GetImportStatusRequestSchema, response: ImportStatusResponseSchema })
  @ApiOperation({ summary: 'Get the status of one import run' })
  @ApiParam({ name: 'importId', description: 'Import run UUID' })
  @ApiOkResponse({
    schema: singleEnvelopeJsonSchema(z.toJSONSchema(ImportStatusResponseSchema) as SwaggerSchema),
  })
  public async getStatus(
    @ModelBinder(GetImportStatusRequestSchema)
    bound: BoundRequest<typeof GetImportStatusRequestSchema>,
  ): Promise<ImportStatusResponse> {
    const headers = buildOutboundHeaders(this.requestContextService.requireContext());
    const record = new RmqRecordBuilder({ importId: bound.data.importId })
      .setOptions({ headers })
      .build();

    const result = await firstValueFrom(
      this.serviceAClient
        .send<ImportStatusResponse | null>(RPC_PATTERNS.IMPORTS_STATUS_GET, record)
        .pipe(timeout(this.rabbitmqConfiguration.rpcTimeoutMs)),
    );

    if (result === null) {
      throw new ImportNotFoundError(bound.data.importId);
    }

    return result;
  }
}
