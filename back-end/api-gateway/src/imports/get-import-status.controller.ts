import { Controller, Get, Inject, Param, ParseUUIDPipe } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { type ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { buildOutboundHeaders } from '@task1/shared/request-context/propagation.util';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { firstValueFrom, timeout } from 'rxjs';

import rabbitmqConfig from '../config/rabbitmq.config.js';

import {
  type IImportStatusView,
  ImportStatusResponseDto,
} from './dto/import-status-response.dto.js';
import { ImportNotFoundError } from './errors.js';
import { SERVICE_A_RMQ_CLIENT } from './rabbitmq-client.token.js';

const IMPORTS_STATUS_GET_PATTERN = 'imports.status.get';

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
  @ApiOperation({ summary: 'Get the status of one import run' })
  @ApiParam({ name: 'importId', description: 'Import run UUID' })
  @ApiOkResponse({ type: ImportStatusResponseDto })
  public async getStatus(
    @Param('importId', new ParseUUIDPipe()) importId: string,
  ): Promise<ImportStatusResponseDto> {
    const headers = buildOutboundHeaders(this.requestContextService.requireContext());
    const record = new RmqRecordBuilder({ importId }).setOptions({ headers }).build();

    const result = await firstValueFrom(
      this.serviceAClient
        .send<IImportStatusView | null>(IMPORTS_STATUS_GET_PATTERN, record)
        .pipe(timeout(this.rabbitmqConfiguration.rpcTimeoutMs)),
    );

    if (result === null) {
      throw new ImportNotFoundError(importId);
    }

    return new ImportStatusResponseDto(result);
  }
}
