import { Controller, Get, Inject } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import {
  type ApiResponseSchemaHost,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { buildOutboundHeaders } from '@task1/shared/request-context/propagation.util';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { firstValueFrom, timeout } from 'rxjs';
import { z } from 'zod';

import rabbitmqConfig from '../config/rabbitmq.config.js';
import { Contract } from '../contract/decorators/contract.decorator.js';
import { type BoundRequest, ModelBinder } from '../contract/decorators/model-binder.decorator.js';
import { singleEnvelopeJsonSchema } from '../contract/schemas/envelope-json-schema.js';

import { SERVICE_B_RMQ_CLIENT } from './rabbitmq-client.token.js';
import { GetStatsRequestSchema } from './schemas/get-stats-request.schema.js';
import { type StatsResponse, StatsResponseSchema } from './schemas/stats-response.schema.js';

const STATS_GET_PATTERN = 'stats.get';

// zod's z.toJSONSchema() return type isn't structurally identical to
// @nestjs/swagger's SchemaObject (recursive `not`/`allOf` typing differs),
// so it needs an explicit cast at this doc-generation boundary only — the
// runtime contract enforcement (ContractValidationInterceptor) is unaffected.
type SwaggerSchema = ApiResponseSchemaHost['schema'];

@ApiTags('stats')
@Controller('stats')
export class StatsController {
  public constructor(
    @Inject(SERVICE_B_RMQ_CLIENT) private readonly serviceBClient: ClientProxy,
    private readonly requestContextService: RequestContextService,
    @Inject(rabbitmqConfig.KEY)
    private readonly rabbitmqConfiguration: ConfigType<typeof rabbitmqConfig>,
  ) {}

  @Get()
  @Contract({ request: GetStatsRequestSchema, response: StatsResponseSchema })
  @ApiOperation({ summary: 'Get processing statistics, optionally scoped to one import' })
  @ApiQuery({ name: 'importId', required: false, description: 'Import run UUID' })
  @ApiOkResponse({
    schema: singleEnvelopeJsonSchema(z.toJSONSchema(StatsResponseSchema) as SwaggerSchema),
  })
  public async getStats(
    @ModelBinder(GetStatsRequestSchema) bound: BoundRequest<typeof GetStatsRequestSchema>,
  ): Promise<StatsResponse> {
    const headers = buildOutboundHeaders(this.requestContextService.requireContext());
    const record = new RmqRecordBuilder(bound.data).setOptions({ headers }).build();

    return await firstValueFrom(
      this.serviceBClient
        .send<StatsResponse>(STATS_GET_PATTERN, record)
        .pipe(timeout(this.rabbitmqConfiguration.rpcTimeoutMs)),
    );
  }
}
