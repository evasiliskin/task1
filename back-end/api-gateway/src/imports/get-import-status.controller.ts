import { Controller, Get, Inject } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { type IImportStatusView } from '@task1/shared/github-archive/index';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';
import { ContextPropagatingClient } from '@task1/shared/request-context/rmq/context-propagating.client';
import { firstValueFrom, timeout } from 'rxjs';

import rabbitmqConfig from '../config/rabbitmq.config.js';
import { ApiSingleResponse } from '../contract/decorators/api-envelope-response.decorator.js';
import { Contract } from '../contract/decorators/contract.decorator.js';
import { type BoundRequest, ModelBinder } from '../contract/decorators/model-binder.decorator.js';
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
    private readonly propagatingClient: ContextPropagatingClient,
    @Inject(rabbitmqConfig.KEY)
    private readonly rabbitmqConfiguration: ConfigType<typeof rabbitmqConfig>,
  ) {}

  @Get(':importId')
  @Contract({ request: GetImportStatusRequestSchema, response: ImportStatusResponseSchema })
  @ApiOperation({ summary: 'Get the status of one import run' })
  @ApiParam({ name: 'importId', description: 'Import run UUID' })
  @ApiSingleResponse(ImportStatusResponseSchema)
  public async getStatus(
    @ModelBinder(GetImportStatusRequestSchema)
    bound: BoundRequest<typeof GetImportStatusRequestSchema>,
  ): Promise<ImportStatusResponse> {
    const result = await firstValueFrom(
      this.propagatingClient
        .send<IImportStatusView | null>(this.serviceAClient, RPC_PATTERNS.IMPORTS_STATUS_GET, {
          importId: bound.data.importId,
        })
        .pipe(timeout(this.rabbitmqConfiguration.rpcTimeoutMs)),
    );

    if (result === null) {
      throw new ImportNotFoundError(bound.data.importId);
    }

    return result;
  }
}
