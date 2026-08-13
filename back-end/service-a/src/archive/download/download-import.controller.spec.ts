import { type LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';

import { type ImportOrchestrationService } from '../import-orchestration.service.js';
import { type ImportRunTracker } from '../import-run-tracker.service.js';
import { type IImportRunDocument } from '../import-run.types.js';

import { DownloadImportController } from './download-import.controller.js';

describe('DownloadImportController', () => {
  const validPayload = {
    importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    dateHour: '2026-08-11-0',
  };
  const correlationId = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  function buildController(
    findByImportId: ReturnType<typeof vi.fn>,
    importDownload: ReturnType<typeof vi.fn>,
    requestContextService: RequestContextService,
  ): { controller: DownloadImportController; infoMock: ReturnType<typeof vi.fn> } {
    const importOrchestrationService = { importDownload } as unknown as ImportOrchestrationService;
    const importRunTracker = { findByImportId } as unknown as ImportRunTracker;
    const infoMock = vi.fn();
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ info: infoMock }),
    } as unknown as LoggerService;
    const controller = new DownloadImportController(
      importOrchestrationService,
      importRunTracker,
      requestContextService,
      loggerService,
    );

    return { controller, infoMock };
  }

  it('should call importDownload with the validated dateHour, importId, and correlationId, when no import is recorded yet', async () => {
    const findByImportId = vi.fn().mockResolvedValue(null);
    const importDownload = vi.fn().mockResolvedValue({
      eventsProcessed: 1,
      validEvents: 1,
      invalidEvents: 0,
      duplicateEvents: 0,
      errorCount: 0,
    });
    const requestContextService = new RequestContextService();
    const { controller } = buildController(findByImportId, importDownload, requestContextService);

    await requestContextService.run({ correlationId, requestId: correlationId }, async () => {
      await controller.handleDownload(validPayload);
    });

    expect(findByImportId).toHaveBeenCalledWith(validPayload.importId);
    expect(importDownload).toHaveBeenCalledWith(
      validPayload.dateHour,
      validPayload.importId,
      correlationId,
    );
  });

  it('should skip importDownload and log, when the importId is already recorded', async () => {
    const existing = { importId: validPayload.importId } as unknown as IImportRunDocument;
    const findByImportId = vi.fn().mockResolvedValue(existing);
    const importDownload = vi.fn();
    const requestContextService = new RequestContextService();
    const { controller, infoMock } = buildController(
      findByImportId,
      importDownload,
      requestContextService,
    );

    await requestContextService.run({ correlationId, requestId: correlationId }, async () => {
      await controller.handleDownload(validPayload);
    });

    expect(importDownload).not.toHaveBeenCalled();
    expect(infoMock).toHaveBeenCalledWith(
      { importId: validPayload.importId },
      'Import already recorded, skipping duplicate download trigger',
    );
  });

  it('should throw and not call findByImportId, when the payload fails schema validation', async () => {
    const findByImportId = vi.fn();
    const requestContextService = new RequestContextService();
    const { controller } = buildController(findByImportId, vi.fn(), requestContextService);

    await requestContextService.run({ correlationId, requestId: correlationId }, async () => {
      await expect(controller.handleDownload({ importId: 'not-a-uuid' })).rejects.toThrow();
    });
    expect(findByImportId).not.toHaveBeenCalled();
  });
});
