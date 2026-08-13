import { randomUUID } from 'node:crypto';

import { Body, Controller, Headers, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { type ClientProxy } from '@nestjs/microservices';
import { ApiAcceptedResponse, ApiHeader, ApiTags } from '@nestjs/swagger';
import { isUUID } from 'class-validator';

import { TriggerDownloadImportDto } from './dto/trigger-download-import.dto.js';
import { TriggerImportResponseDto } from './dto/trigger-import-response.dto.js';
import { InvalidIdempotencyKeyError } from './errors.js';
import { SERVICE_A_RMQ_CLIENT } from './rabbitmq-client.token.js';

const ARCHIVE_IMPORT_DOWNLOAD_PATTERN = 'archive.import.download';

@ApiTags('imports')
@Controller('imports')
export class TriggerImportController {
  public constructor(@Inject(SERVICE_A_RMQ_CLIENT) private readonly serviceAClient: ClientProxy) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Client-supplied UUID. Replaying the same key returns the same importId and does not start a second import.',
  })
  @ApiAcceptedResponse({ type: TriggerImportResponseDto })
  public trigger(
    @Body() dto: TriggerDownloadImportDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): TriggerImportResponseDto {
    if (idempotencyKey !== undefined && !isUUID(idempotencyKey)) {
      throw new InvalidIdempotencyKeyError(idempotencyKey);
    }

    const importId = idempotencyKey ?? randomUUID();

    this.serviceAClient.emit(ARCHIVE_IMPORT_DOWNLOAD_PATTERN, { importId, dateHour: dto.dateHour });

    return new TriggerImportResponseDto(importId);
  }
}
