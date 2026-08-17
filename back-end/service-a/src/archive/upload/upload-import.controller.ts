import { Controller } from '@nestjs/common';
import { Ctx, EventPattern, Payload, type RmqContext } from '@nestjs/microservices';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/logger.service';
import { ackMessage } from '@task1/shared/messaging/ack.util';
import { RetryPublisher } from '@task1/shared/messaging/retry-publisher';
import { type IRmqChannel, type IRmqMessage } from '@task1/shared/messaging/rmq-channel.types';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';

import { ImportOrchestrationService } from '../import-orchestration.service.js';
import { settleImportResult } from '../import-settlement.js';

import { uploadImportMessageSchema } from './upload-import-message.schema.js';

const MALFORMED_MESSAGE_LOG = 'Rejected malformed upload-import message, acking without importing';

@Controller()
export class UploadImportController {
  public constructor(
    private readonly importOrchestrationService: ImportOrchestrationService,
    private readonly retryPublisher: RetryPublisher,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger(UploadImportController.name);
  }

  @EventPattern(RPC_PATTERNS.ARCHIVE_PROCESS_UPLOAD)
  public async handleUpload(
    @Payload() payload: unknown,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const parsed = uploadImportMessageSchema.safeParse(payload);

    if (!parsed.success) {
      this.logger.warn({}, MALFORMED_MESSAGE_LOG, parsed.error);
      ackMessage(context);

      return;
    }

    const { importId, filePath } = parsed.data;

    await settleImportResult({
      run: (delivery) => this.importOrchestrationService.importUpload(filePath, importId, delivery),
      channel: context.getChannelRef() as IRmqChannel,
      message: context.getMessage() as IRmqMessage,
      retryPublisher: this.retryPublisher,
      logger: this.logger,
      importId,
    });
  }

  private readonly logger: AppLogger;
}
