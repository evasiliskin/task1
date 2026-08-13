import { Controller } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, type RmqContext } from '@nestjs/microservices';

import { generateReportMessageSchema } from './generate-report-message.schema.js';
import { type IGenerateReportResult } from './generate-report.js';
import { ReportsService } from './reports.service.js';

@Controller()
export class ReportsController {
  public constructor(private readonly reportsService: ReportsService) {}

  @MessagePattern('reports.pdf.generate')
  public async handleGenerateReport(
    @Payload() payload: unknown,
    @Ctx() context: RmqContext,
  ): Promise<IGenerateReportResult> {
    try {
      const message = generateReportMessageSchema.parse(payload);

      return await this.reportsService.generateReport(message.importId);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- RmqContext channel is loosely typed; matches HealthController's manual-ack precedent under noAck: false
      context.getChannelRef().ack(context.getMessage());
    }
  }
}
