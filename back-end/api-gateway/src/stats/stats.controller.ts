import { Controller, Get, Inject, Query } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { buildOutboundHeaders } from '@task1/shared/request-context/propagation.util';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { firstValueFrom, timeout } from 'rxjs';

import rabbitmqConfig from '../config/rabbitmq.config.js';

import { GetStatsQueryDto } from './dto/get-stats-query.dto.js';
import { type IStatsView, StatsResponseDto } from './dto/stats-response.dto.js';
import { SERVICE_B_RMQ_CLIENT } from './rabbitmq-client.token.js';

const STATS_GET_PATTERN = 'stats.get';

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
  @ApiOperation({ summary: 'Get processing statistics, optionally scoped to one import' })
  @ApiQuery({ name: 'importId', required: false, description: 'Import run UUID' })
  @ApiOkResponse({ type: StatsResponseDto })
  public async getStats(@Query() query: GetStatsQueryDto): Promise<StatsResponseDto> {
    const headers = buildOutboundHeaders(this.requestContextService.requireContext());
    const record = new RmqRecordBuilder(query).setOptions({ headers }).build();

    const result = await firstValueFrom(
      this.serviceBClient
        .send<IStatsView>(STATS_GET_PATTERN, record)
        .pipe(timeout(this.rabbitmqConfiguration.rpcTimeoutMs)),
    );

    return new StatsResponseDto(result);
  }
}
