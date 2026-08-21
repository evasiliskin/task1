import { Controller } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, type RmqContext } from '@nestjs/microservices';
import { type IImportStatusView } from '@task1/shared/github-archive/index';
import { ackMessage } from '@task1/shared/messaging/ack.util';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';

import { ImportRunTracker } from './import-run-tracker.service.js';
import { importStatusMessageSchema } from './import-status-message.schema.js';
import { toImportStatusView } from './to-import-status-view.js';

@Controller()
export class ImportStatusController {
  public constructor(private readonly importRunTracker: ImportRunTracker) {}

  @MessagePattern(RPC_PATTERNS.IMPORTS_STATUS_GET)
  public async handleGetStatus(
    @Payload() payload: unknown,
    @Ctx() context: RmqContext,
  ): Promise<IImportStatusView | null> {
    try {
      const { importId } = importStatusMessageSchema.parse(payload);
      const document = await this.importRunTracker.findByImportId(importId);

      return document === null ? null : toImportStatusView(document);
    } finally {
      ackMessage(context);
    }
  }
}
