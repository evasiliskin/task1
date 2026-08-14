import { Controller } from '@nestjs/common';
import { Ctx, EventPattern, Payload, type RmqContext } from '@nestjs/microservices';
import { LoggerAware } from '@task1/shared/logger/logger-aware.base';
import { LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';

import { ImportAlreadyClaimedError } from '../import-claim.error.js';
import { ImportOrchestrationService } from '../import-orchestration.service.js';
import { ackMessage } from '../rmq-ack.util.js';

import { downloadImportMessageSchema } from './download-import-message.schema.js';

const ALREADY_CLAIMED_LOG_MESSAGE =
  'Import already claimed by another consumer, skipping duplicate';

@Controller()
export class DownloadImportController extends LoggerAware {
  public constructor(
    private readonly importOrchestrationService: ImportOrchestrationService,
    private readonly requestContextService: RequestContextService,
    loggerService: LoggerService,
  ) {
    super(loggerService);
  }

  @EventPattern(RPC_PATTERNS.ARCHIVE_IMPORT_DOWNLOAD)
  public async handleDownload(
    @Payload() payload: unknown,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    try {
      const { importId, dateHour } = downloadImportMessageSchema.parse(payload);
      const { correlationId } = this.requestContextService.requireContext();

      try {
        await this.importOrchestrationService.importDownload(dateHour, importId, correlationId);
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
