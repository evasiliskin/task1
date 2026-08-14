import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';

import { ImportOrchestrationService } from '../import-orchestration.service.js';
import { ImportRunTracker } from '../import-run-tracker.service.js';

import { downloadImportMessageSchema } from './download-import-message.schema.js';

const ALREADY_RECORDED_LOG_MESSAGE = 'Import already recorded, skipping duplicate download trigger';

@Controller()
export class DownloadImportController {
  public constructor(
    private readonly importOrchestrationService: ImportOrchestrationService,
    private readonly importRunTracker: ImportRunTracker,
    private readonly requestContextService: RequestContextService,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger('DownloadImportController');
  }

  @EventPattern('archive.import.download')
  public async handleDownload(@Payload() payload: unknown): Promise<void> {
    const { importId, dateHour } = downloadImportMessageSchema.parse(payload);
    const existing = await this.importRunTracker.findByImportId(importId);

    if (existing !== null) {
      this.logger.info({ importId }, ALREADY_RECORDED_LOG_MESSAGE);

      return;
    }

    const { correlationId } = this.requestContextService.requireContext();

    await this.importOrchestrationService.importDownload(dateHour, importId, correlationId);
  }

  private readonly logger: AppLogger;
}
