import { Controller } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, type RmqContext } from '@nestjs/microservices';
import { ackMessage } from '@task1/shared/messaging/ack.util';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';

import { MetricsService } from '../infra/redis/metrics.service.js';

import { ImportRunTracker } from './import-run-tracker.service.js';
import { type IImportRunDocument } from './import-run.types.js';
import { importStatusMessageSchema } from './import-status-message.schema.js';

const METRIC_STATUS_REQUESTS = 'service_a.archive.status.requests';

@Controller()
export class ImportStatusController {
  public constructor(
    private readonly importRunTracker: ImportRunTracker,
    private readonly metricsService: MetricsService,
  ) {}

  @MessagePattern(RPC_PATTERNS.IMPORTS_STATUS_GET)
  public async handleGetStatus(
    @Payload() payload: unknown,
    @Ctx() context: RmqContext,
  ): Promise<IImportRunDocument | null> {
    try {
      const { importId } = importStatusMessageSchema.parse(payload);
      const result = await this.importRunTracker.findByImportId(importId);

      await this.metricsService.recordMetric(METRIC_STATUS_REQUESTS, 1);

      return result;
    } finally {
      ackMessage(context);
    }
  }
}
