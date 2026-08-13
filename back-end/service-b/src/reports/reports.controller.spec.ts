import { type RmqContext } from '@nestjs/microservices';

import { ReportsController } from './reports.controller.js';
import { type ReportsService } from './reports.service.js';

describe('ReportsController', () => {
  function buildContext(): {
    context: RmqContext;
    message: Record<string, unknown>;
    ack: ReturnType<typeof vi.fn>;
  } {
    const message = { content: Buffer.from('{}'), properties: { headers: {} } };
    const ack = vi.fn();
    const context = {
      getChannelRef: vi.fn().mockReturnValue({ ack }),
      getMessage: vi.fn().mockReturnValue(message),
    } as unknown as RmqContext;

    return { context, message, ack };
  }

  it('should validate the payload, delegate to ReportsService, and ack, when a valid message is received', async () => {
    const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const generateReportResult = {
      reportPath: '/data/reports/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.pdf',
    };
    const generateReport = vi.fn().mockResolvedValue(generateReportResult);
    const reportsService = { generateReport } as unknown as ReportsService;
    const controller = new ReportsController(reportsService);
    const { context, message, ack } = buildContext();

    const result = await controller.handleGenerateReport({ importId }, context);

    expect(result).toBe(generateReportResult);
    expect(generateReport).toHaveBeenCalledWith(importId);
    expect(ack).toHaveBeenCalledWith(message);
  });

  it('should reject but still ack, when the payload fails schema validation', async () => {
    const generateReport = vi.fn();
    const reportsService = { generateReport } as unknown as ReportsService;
    const controller = new ReportsController(reportsService);
    const { context, message, ack } = buildContext();

    await expect(
      controller.handleGenerateReport({ importId: 'not-a-uuid' }, context),
    ).rejects.toThrow();
    expect(generateReport).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith(message);
  });
});
