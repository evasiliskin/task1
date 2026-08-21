import { Controller } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, type RmqContext } from '@nestjs/microservices';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/logger.service';
import { ackMessage } from '@task1/shared/messaging/ack.util';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';

import { generateReportMessageSchema } from './generate-report-message.schema.js';
import { type IGenerateReportResult } from './generate-report.js';
import { ReportsService } from './reports.service.js';

const REPORT_GENERATED_LOG = 'pdf report generated';
const REPORT_FAILED_LOG = 'pdf report generation failed';

@Controller()
export class ReportsController {
  public constructor(
    private readonly reportsService: ReportsService,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger(ReportsController.name);
  }

  @MessagePattern(RPC_PATTERNS.REPORTS_PDF_GENERATE)
  public async handleGenerateReport(
    @Payload() payload: unknown,
    @Ctx() context: RmqContext,
  ): Promise<IGenerateReportResult> {
    const startedAt = Date.now();

    try {
      const message = generateReportMessageSchema.parse(payload);
      const result = await this.reportsService.generateReport(message.importId);

      this.logger.info(
        { importId: message.importId ?? 'aggregate', durationMs: Date.now() - startedAt },
        REPORT_GENERATED_LOG,
      );

      return result;
    } catch (error) {
      this.logger.error({ durationMs: Date.now() - startedAt }, REPORT_FAILED_LOG, error);

      throw error;
    } finally {
      ackMessage(context);
    }
  }

  private readonly logger: AppLogger;
}
