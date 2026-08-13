import { type MetricsService } from '../infra/redis/metrics.service.js';

import { type ImportRunTracker } from './import-run-tracker.service.js';
import { type IImportRunDocument } from './import-run.types.js';
import { ImportStatusController } from './import-status.controller.js';

describe('ImportStatusController', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  function buildMetricsService(): {
    metricsService: MetricsService;
    recordMetric: ReturnType<typeof vi.fn>;
  } {
    const recordMetric = vi.fn().mockResolvedValue(undefined);

    return { metricsService: { recordMetric } as unknown as MetricsService, recordMetric };
  }

  it('should validate the payload and delegate to ImportRunTracker.findByImportId, when a valid message is received', async () => {
    const document = { importId, status: 'completed' } as unknown as IImportRunDocument;
    const findByImportId = vi.fn().mockResolvedValue(document);
    const importRunTracker = { findByImportId } as unknown as ImportRunTracker;
    const { metricsService } = buildMetricsService();
    const controller = new ImportStatusController(importRunTracker, metricsService);

    const result = await controller.handleGetStatus({ importId });

    expect(result).toBe(document);
    expect(findByImportId).toHaveBeenCalledWith(importId);
  });

  it('should return null, when no import run matches', async () => {
    const findByImportId = vi.fn().mockResolvedValue(null);
    const importRunTracker = { findByImportId } as unknown as ImportRunTracker;
    const { metricsService } = buildMetricsService();
    const controller = new ImportStatusController(importRunTracker, metricsService);

    await expect(controller.handleGetStatus({ importId })).resolves.toBeNull();
  });

  it('should reject and not call findByImportId, when the payload fails schema validation', async () => {
    const findByImportId = vi.fn();
    const importRunTracker = { findByImportId } as unknown as ImportRunTracker;
    const { metricsService, recordMetric } = buildMetricsService();
    const controller = new ImportStatusController(importRunTracker, metricsService);

    await expect(controller.handleGetStatus({ importId: 'not-a-uuid' })).rejects.toThrow();
    expect(findByImportId).not.toHaveBeenCalled();
    expect(recordMetric).not.toHaveBeenCalled();
  });

  it('should record a status.requests metric, when a status lookup is handled', async () => {
    const findByImportId = vi.fn().mockResolvedValue(null);
    const importRunTracker = { findByImportId } as unknown as ImportRunTracker;
    const { metricsService, recordMetric } = buildMetricsService();
    const controller = new ImportStatusController(importRunTracker, metricsService);

    await controller.handleGetStatus({ importId });

    expect(recordMetric).toHaveBeenCalledWith('service_a.archive.status.requests', 1);
  });
});
