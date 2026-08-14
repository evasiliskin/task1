import { Controller, Get, Inject } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { listResult } from '@task1/shared/exception-handling/http/list-result';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';
import { buildOutboundHeaders } from '@task1/shared/request-context/propagation.util';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { firstValueFrom, timeout } from 'rxjs';
import { z } from 'zod';

import rabbitmqConfig from '../config/rabbitmq.config.js';
import { Contract } from '../contract/decorators/contract.decorator.js';
import { type BoundRequest, ModelBinder } from '../contract/decorators/model-binder.decorator.js';
import { listEnvelopeJsonSchema } from '../contract/schemas/envelope-json-schema.js';
import { type SwaggerSchema } from '../contract/schemas/swagger-schema.type.js';
import { SERVICE_A_RMQ_CLIENT } from '../rmq/rmq-client.tokens.js';

import { type EventView } from './schemas/event.schema.js';
import { SearchEventsRequestSchema } from './schemas/search-events-request.schema.js';
import {
  type SearchEventsResponse,
  SearchEventsResponseSchema,
  SearchEventsResultShape,
} from './schemas/search-events-response.schema.js';

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- deliberately a `type`, not an `I`-prefixed `interface`, matching the RMQ reply shape of `SearchEventsResult`
type SearchEventsRpcResult = { data: EventView[]; nextCursor?: string };

@ApiTags('events')
@Controller('events')
export class EventsController {
  public constructor(
    @Inject(SERVICE_A_RMQ_CLIENT) private readonly serviceAClient: ClientProxy,
    private readonly requestContextService: RequestContextService,
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
  @ApiOkResponse({
    schema: listEnvelopeJsonSchema(z.toJSONSchema(SearchEventsResultShape) as SwaggerSchema),
  })
  public async search(
    @ModelBinder(SearchEventsRequestSchema)
    bound: BoundRequest<typeof SearchEventsRequestSchema>,
  ): Promise<SearchEventsResponse> {
    const headers = buildOutboundHeaders(this.requestContextService.requireContext());
    const record = new RmqRecordBuilder(bound.data).setOptions({ headers }).build();

    const result = await firstValueFrom(
      this.serviceAClient
        .send<SearchEventsRpcResult>(RPC_PATTERNS.EVENTS_SEARCH, record)
        .pipe(timeout(this.rabbitmqConfiguration.rpcTimeoutMs)),
    );

    return listResult(result.data, { nextCursor: result.nextCursor });
  }
}
