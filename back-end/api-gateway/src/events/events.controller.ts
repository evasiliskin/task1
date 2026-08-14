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

import { SERVICE_A_RMQ_CLIENT } from './rabbitmq-client.token.js';
import { type EventView } from './schemas/event.schema.js';
import { SearchEventsRequestSchema } from './schemas/search-events-request.schema.js';
import {
  type SearchEventsResponse,
  SearchEventsResponseSchema,
} from './schemas/search-events-response.schema.js';

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- deliberately a `type`, not an `I`-prefixed `interface`, matching the RMQ reply shape of `SearchEventsResult`
type SearchEventsRpcResult = { data: EventView[]; nextCursor?: string };

const EVENTS_SEARCH_PATTERN = 'events.search';

// zod's z.toJSONSchema() return type isn't structurally identical to
// @nestjs/swagger's SchemaObject (recursive `not`/`allOf` typing differs),
// so it needs an explicit cast at this doc-generation boundary only — the
// runtime contract enforcement (ContractValidationInterceptor) is unaffected.
type SwaggerSchema = ApiResponseSchemaHost['schema'];

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
  @ApiOkResponse({ schema: z.toJSONSchema(SearchEventsResponseSchema) as SwaggerSchema })
  public async search(
    @ModelBinder(SearchEventsRequestSchema)
    bound: BoundRequest<typeof SearchEventsRequestSchema>,
  ): Promise<SearchEventsResponse> {
    const headers = buildOutboundHeaders(this.requestContextService.requireContext());
    const record = new RmqRecordBuilder(bound.data).setOptions({ headers }).build();

    const result = await firstValueFrom(
      this.serviceAClient
        .send<SearchEventsRpcResult>(EVENTS_SEARCH_PATTERN, record)
        .pipe(timeout(this.rabbitmqConfiguration.rpcTimeoutMs)),
    );

    return { data: result.data, nextCursor: result.nextCursor };
  }
}
