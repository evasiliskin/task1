import { Controller } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, type RmqContext } from '@nestjs/microservices';
import { type IImportClaimView } from '@task1/shared/github-archive/index';
import { ackMessage } from '@task1/shared/messaging/ack.util';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';

import { ImportRunTracker } from '../import-run-tracker.service.js';

import { claimImportMessageSchema } from './claim-import-message.schema.js';

@Controller()
export class ClaimImportController {
  public constructor(private readonly importRunTracker: ImportRunTracker) {}

  @MessagePattern(RPC_PATTERNS.IMPORTS_CLAIM)
  public async handleClaim(
    @Payload() payload: unknown,
    @Ctx() context: RmqContext,
  ): Promise<IImportClaimView> {
    try {
      const { idempotencyKey } = claimImportMessageSchema.parse(payload);

      return await this.importRunTracker.claim(idempotencyKey);
    } finally {
      ackMessage(context);
    }
  }
}
