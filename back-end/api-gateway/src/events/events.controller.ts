import { Controller, Get, Inject } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type ClientProxy } from '@nestjs/microservices';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { type IEventView } from '@task1/shared/github-archive/index';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';
import { type ICursorPage } from '@task1/shared/pagination/cursor-page.types';
import { listResult } from '@task1/shared/pagination/list-result';
import { ContextPropagatingClient } from '@task1/shared/request-context/rmq/context-propagating.client';
import { firstValueFrom, timeout } from 'rxjs';

import rabbitmqConfig from '../config/rabbitmq.config.js';
import { ApiListResponse } from '../contract/decorators/api-envelope-response.decorator.js';
import { Contract } from '../contract/decorators/contract.decorator.js';
import { type BoundRequest, ModelBinder } from '../contract/decorators/model-binder.decorator.js';
import { SERVICE_A_RMQ_CLIENT } from '../rmq/rmq-client.tokens.js';

import { SearchEventsRequestSchema } from './schemas/search-events-request.schema.js';
import {
  type SearchEventsResponse,
  SearchEventsResponseSchema,
  SearchEventsResultShape,
} from './schemas/search-events-response.schema.js';

@ApiTags('events')
@Controller('events')
export class EventsController {
  public constructor(
    @Inject(SERVICE_A_RMQ_CLIENT) private readonly serviceAClient: ClientProxy,
    private readonly propagatingClient: ContextPropagatingClient,
    @Inject(rabbitmqConfig.KEY)
    private readonly rabbitmqConfiguration: ConfigType<typeof rabbitmqConfig>,
  ) {}

  @Get()
  @Contract({ request: SearchEventsRequestSchema, response: SearchEventsResponseSchema })
  @ApiOperation({ summary: 'Search imported GitHub events with filters and cursor pagination' })
  @ApiQuery({ name: 'type', required: false, description: 'GitHub event type, e.g. PushEvent' })
  @ApiQuery({
    name: 'repository',
    required: false,
    description: 'Repository full name, e.g. octocat/hello-world',
  })
  @ApiQuery({ name: 'actor', required: false, description: 'Actor login' })
  @ApiQuery({ name: 'from', required: false, description: 'ISO-8601 lower bound for createdAt' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO-8601 upper bound for createdAt' })
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
  @ApiListResponse(SearchEventsResultShape)
  public async search(
    @ModelBinder(SearchEventsRequestSchema)
    bound: BoundRequest<typeof SearchEventsRequestSchema>,
  ): Promise<SearchEventsResponse> {
    const result = await firstValueFrom(
      this.propagatingClient
        .send<ICursorPage<IEventView>>(this.serviceAClient, RPC_PATTERNS.EVENTS_SEARCH, bound.data)
        .pipe(timeout(this.rabbitmqConfiguration.rpcTimeoutMs)),
    );

    return listResult(result.data, { nextCursor: result.nextCursor });
  }
}
