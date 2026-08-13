import { Controller, Get, Inject, Query } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { buildOutboundHeaders } from '@task1/shared/request-context/propagation.util';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { firstValueFrom, timeout } from 'rxjs';

import rabbitmqConfig from '../config/rabbitmq.config.js';

import { type ILogEntryView, LogResponseDto } from './dto/log-response.dto.js';
import { SearchLogsQueryDto } from './dto/search-logs-query.dto.js';
import { SearchLogsResponseDto } from './dto/search-logs-response.dto.js';
import { SERVICE_B_RMQ_CLIENT } from './rabbitmq-client.token.js';

type SearchLogsRpcEntry = Omit<ILogEntryView, 'timestamp'> & { timestamp: string };
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- matches the RMQ reply shape of service-b's SearchLogsResult, same convention as EventsController's SearchEventsRpcResult.
type SearchLogsRpcResult = { data: SearchLogsRpcEntry[]; nextCursor?: string };

const LOGS_SEARCH_PATTERN = 'logs.search';

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
  @ApiOperation({ summary: 'Search processing logs with filters and cursor pagination' })
  @ApiQuery({ name: 'importId', required: false, description: 'Import run UUID' })
  @ApiQuery({ name: 'status', required: false, description: 'started | completed | failed' })
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
  @ApiOkResponse({ type: SearchLogsResponseDto })
  public async search(@Query() query: SearchLogsQueryDto): Promise<SearchLogsResponseDto> {
    const headers = buildOutboundHeaders(this.requestContextService.requireContext());
    const record = new RmqRecordBuilder(query).setOptions({ headers }).build();

    const result = await firstValueFrom(
      this.serviceBClient
        .send<SearchLogsRpcResult>(LOGS_SEARCH_PATTERN, record)
        .pipe(timeout(this.rabbitmqConfiguration.rpcTimeoutMs)),
    );

    const data = result.data.map((entry) => new LogResponseDto(entry));

    return new SearchLogsResponseDto(data, result.nextCursor);
  }
}
