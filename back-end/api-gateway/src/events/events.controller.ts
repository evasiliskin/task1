import { Controller, Get, Inject, Query } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { buildOutboundHeaders } from '@task1/shared/request-context/propagation.util';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { firstValueFrom, timeout } from 'rxjs';

import rabbitmqConfig from '../config/rabbitmq.config.js';

import { EventResponseDto } from './dto/event-response.dto.js';
import { SearchEventsQueryDto } from './dto/search-events-query.dto.js';
import { SearchEventsResponseDto } from './dto/search-events-response.dto.js';
import { SERVICE_A_RMQ_CLIENT } from './rabbitmq-client.token.js';

type SearchEventsRpcEvent = Omit<IGithubEventDocument, 'createdAt'> & { createdAt: string };
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- deliberately a `type`, not an `I`-prefixed `interface`, matching the RMQ reply shape of `SearchEventsResult`
type SearchEventsRpcResult = { data: SearchEventsRpcEvent[]; nextCursor?: string };

const EVENTS_SEARCH_PATTERN = 'events.search';

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
  @ApiOkResponse({ type: SearchEventsResponseDto })
  public async search(@Query() query: SearchEventsQueryDto): Promise<SearchEventsResponseDto> {
    const headers = buildOutboundHeaders(this.requestContextService.requireContext());
    const record = new RmqRecordBuilder(query).setOptions({ headers }).build();

    const result = await firstValueFrom(
      this.serviceAClient
        .send<SearchEventsRpcResult>(EVENTS_SEARCH_PATTERN, record)
        .pipe(timeout(this.rabbitmqConfiguration.rpcTimeoutMs)),
    );

    const data = result.data.map((event) => new EventResponseDto(event));

    return new SearchEventsResponseDto(data, result.nextCursor);
  }
}
