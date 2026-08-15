import { Controller } from '@nestjs/common';
import { Ctx, EventPattern, Payload, type RmqContext } from '@nestjs/microservices';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/logger.service';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';

import { ImportAlreadyClaimedError } from '../import-claim.error.js';
import { ImportOrchestrationService } from '../import-orchestration.service.js';
import { ackMessage } from '../rmq-ack.util.js';

import { downloadImportMessageSchema } from './download-import-message.schema.js';

const ALREADY_CLAIMED_LOG_MESSAGE =
  'Import already claimed by another consumer, skipping duplicate';

@Controller()
export class DownloadImportController {
  public constructor(
    private readonly importOrchestrationService: ImportOrchestrationService,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger(DownloadImportController.name);
  }

  @EventPattern(RPC_PATTERNS.ARCHIVE_IMPORT_DOWNLOAD)
  public async handleDownload(
    @Payload() payload: unknown,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    try {
      const { importId, dateHour } = downloadImportMessageSchema.parse(payload);

      try {
        await this.importOrchestrationService.importDownload(dateHour, importId);
      } catch (error) {
        if (error instanceof ImportAlreadyClaimedError) {
          this.logger.info({ importId }, ALREADY_CLAIMED_LOG_MESSAGE);

          return;
        }

        throw error;
      }
    } finally {
      ackMessage(context);
    }
  }

  private readonly logger: AppLogger;
}
