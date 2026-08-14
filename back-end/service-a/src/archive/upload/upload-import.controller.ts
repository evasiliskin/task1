import { Controller } from '@nestjs/common';
import { Ctx, EventPattern, Payload, type RmqContext } from '@nestjs/microservices';
import { LoggerAware } from '@task1/shared/logger/logger-aware.base';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';

import { ImportAlreadyClaimedError } from '../import-claim.error.js';
import { ImportOrchestrationService } from '../import-orchestration.service.js';
import { ackMessage } from '../rmq-ack.util.js';

import { uploadImportMessageSchema } from './upload-import-message.schema.js';

const ALREADY_CLAIMED_LOG_MESSAGE =
  'Import already claimed by another consumer, skipping duplicate';

@Controller()
export class UploadImportController extends LoggerAware {
  public constructor(
    private readonly importOrchestrationService: ImportOrchestrationService,
    private readonly requestContextService: RequestContextService,
    loggerService: LoggerService,
  ) {
    super(loggerService);
  }

  @EventPattern(RPC_PATTERNS.ARCHIVE_PROCESS_UPLOAD)
  public async handleUpload(
    @Payload() payload: unknown,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    try {
      const { importId, filePath } = uploadImportMessageSchema.parse(payload);
      const { correlationId } = this.requestContextService.requireContext();

      try {
        await this.importOrchestrationService.importUpload(filePath, importId, correlationId);
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
}
