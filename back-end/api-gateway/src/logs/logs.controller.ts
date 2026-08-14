import { Controller, Get, Inject } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';
import { type ICursorPage } from '@task1/shared/pagination/cursor-page.types';
import { listResult } from '@task1/shared/pagination/list-result';
import { buildOutboundHeaders } from '@task1/shared/request-context/propagation.util';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { firstValueFrom, timeout } from 'rxjs';

import rabbitmqConfig from '../config/rabbitmq.config.js';
import { ApiListResponse } from '../contract/decorators/api-envelope-response.decorator.js';
import { Contract } from '../contract/decorators/contract.decorator.js';
import { type BoundRequest, ModelBinder } from '../contract/decorators/model-binder.decorator.js';
import { SERVICE_B_RMQ_CLIENT } from '../rmq/rmq-client.tokens.js';

import { SearchLogsRequestSchema } from './schemas/search-logs-request.schema.js';
import {
  type LogEntry,
  type SearchLogsResponse,
  SearchLogsResponseSchema,
  SearchLogsResultShape,
} from './schemas/search-logs-response.schema.js';

@ApiTags('logs')
@Controller('logs')
export class LogsController {
  public constructor(
    @Inject(SERVICE_B_RMQ_CLIENT) private readonly serviceBClient: ClientProxy,
    private readonly requestContextService: RequestContextService,
    @Inject(rabbitmqConfig.KEY)
    private readonly rabbitmqConfiguration: ConfigType<typeof rabbitmqConfig>,
  ) {}

  @Get()
  @Contract({ request: SearchLogsRequestSchema, response: SearchLogsResponseSchema })
  @ApiOperation({ summary: 'Search processing logs with filters and cursor pagination' })
  @ApiQuery({ name: 'importId', required: false, description: 'Import run UUID' })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'started | completed | failed | dead-lettered',
  })
  @ApiQuery({ name: 'from', required: false, description: 'ISO-8601 lower bound for timestamp' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO-8601 upper bound for timestamp' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Opaque pagination cursor from a previous response',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Max results per page (default 50, max 200)',
  })
  @ApiListResponse(SearchLogsResultShape)
  public async search(
    @ModelBinder(SearchLogsRequestSchema) bound: BoundRequest<typeof SearchLogsRequestSchema>,
  ): Promise<SearchLogsResponse> {
    const headers = buildOutboundHeaders(this.requestContextService.requireContext());
    const record = new RmqRecordBuilder(bound.data).setOptions({ headers }).build();

    const result = await firstValueFrom(
      this.serviceBClient
        .send<ICursorPage<LogEntry>>(RPC_PATTERNS.LOGS_SEARCH, record)
        .pipe(timeout(this.rabbitmqConfiguration.rpcTimeoutMs)),
    );

    return listResult(result.data, { nextCursor: result.nextCursor });
  }
}
