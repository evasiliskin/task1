import { Controller } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, type RmqContext } from '@nestjs/microservices';
import { type IImportStatusView } from '@task1/shared/github-archive/index';
import { ackMessage } from '@task1/shared/messaging/ack.util';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';

import { MetricsService } from '../infra/redis/metrics.service.js';

import { ImportRunTracker } from './import-run-tracker.service.js';
import { importStatusMessageSchema } from './import-status-message.schema.js';
import { toImportStatusView } from './to-import-status-view.js';

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
  ): Promise<IImportStatusView | null> {
    try {
      const { importId } = importStatusMessageSchema.parse(payload);
      const document = await this.importRunTracker.findByImportId(importId);

      // eslint-disable-next-line no-void -- Not awaited: a Redis round trip does not belong on the latency path of a read, and `recordMetric` already handles and logs its own failures.
      void this.metricsService.recordMetric(METRIC_STATUS_REQUESTS, 1);

      return document === null ? null : toImportStatusView(document);
    } finally {
      ackMessage(context);
    }
  }
}
