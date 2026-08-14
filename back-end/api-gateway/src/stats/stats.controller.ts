import { Controller, Get, Inject } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
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
import { SERVICE_B_RMQ_CLIENT } from '../rmq/rmq-client.tokens.js';

import { GetStatsRequestSchema } from './schemas/get-stats-request.schema.js';
import { type StatsResponse, StatsResponseSchema } from './schemas/stats-response.schema.js';

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
        .send<StatsResponse>(RPC_PATTERNS.STATS_GET, record)
        .pipe(timeout(this.rabbitmqConfiguration.rpcTimeoutMs)),
    );
  }
}
