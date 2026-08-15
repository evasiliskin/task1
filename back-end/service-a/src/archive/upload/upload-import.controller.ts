import { Controller } from '@nestjs/common';
import { Ctx, EventPattern, Payload, type RmqContext } from '@nestjs/microservices';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/logger.service';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';

import { ImportAlreadyClaimedError } from '../import-claim.error.js';
import { ImportOrchestrationService } from '../import-orchestration.service.js';
import { ackMessage } from '../rmq-ack.util.js';

import { uploadImportMessageSchema } from './upload-import-message.schema.js';

const ALREADY_CLAIMED_LOG_MESSAGE =
  'Import already claimed by another consumer, skipping duplicate';

@Controller()
export class UploadImportController {
  public constructor(
    private readonly importOrchestrationService: ImportOrchestrationService,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger(UploadImportController.name);
  }

  @EventPattern(RPC_PATTERNS.ARCHIVE_PROCESS_UPLOAD)
  public async handleUpload(
    @Payload() payload: unknown,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    try {
      const { importId, filePath } = uploadImportMessageSchema.parse(payload);

      try {
        await this.importOrchestrationService.importUpload(filePath, importId);
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
