import { Controller, Get, Inject } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import {
  type ApiResponseSchemaHost,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { buildOutboundHeaders } from '@task1/shared/request-context/propagation.util';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { firstValueFrom, timeout } from 'rxjs';
import { z } from 'zod';

import rabbitmqConfig from '../config/rabbitmq.config.js';
import { Contract } from '../contract/decorators/contract.decorator.js';
import { type BoundRequest, ModelBinder } from '../contract/decorators/model-binder.decorator.js';

import { ImportNotFoundError } from './errors.js';
import { SERVICE_A_RMQ_CLIENT } from './rabbitmq-client.token.js';
import { GetImportStatusRequestSchema } from './schemas/get-import-status-request.schema.js';
import {
  type ImportStatusResponse,
  ImportStatusResponseSchema,
} from './schemas/import-status-response.schema.js';

const IMPORTS_STATUS_GET_PATTERN = 'imports.status.get';

// zod's z.toJSONSchema() return type isn't structurally identical to
// @nestjs/swagger's SchemaObject (recursive `not`/`allOf` typing differs),
// so it needs an explicit cast at this doc-generation boundary only — the
// runtime contract enforcement (ContractValidationInterceptor) is unaffected.
type SwaggerSchema = ApiResponseSchemaHost['schema'];

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
  @ApiOkResponse({ schema: z.toJSONSchema(ImportStatusResponseSchema) as SwaggerSchema })
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
        .send<ImportStatusResponse | null>(IMPORTS_STATUS_GET_PATTERN, record)
        .pipe(timeout(this.rabbitmqConfiguration.rpcTimeoutMs)),
    );

    if (result === null) {
      throw new ImportNotFoundError(bound.data.importId);
    }

    return result;
  }
}
