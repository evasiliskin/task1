import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';

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

  @MessagePattern('imports.status.get')
  public async handleGetStatus(@Payload() payload: unknown): Promise<IImportRunDocument | null> {
    const { importId } = importStatusMessageSchema.parse(payload);
    const result = await this.importRunTracker.findByImportId(importId);

    await this.metricsService.recordMetric(METRIC_STATUS_REQUESTS, 1);

    return result;
  }
}
