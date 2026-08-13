import { RequestContextService } from '@task1/shared/request-context/request-context.service';

import { type ImportOrchestrationService } from '../import-orchestration.service.js';

import { UploadImportController } from './upload-import.controller.js';

describe('UploadImportController', () => {
  const validPayload = {
    importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    filePath: '/data/archives/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.json.gz',
  };
  const correlationId = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  function buildController(
    importUpload: ReturnType<typeof vi.fn>,
    requestContextService: RequestContextService,
  ): UploadImportController {
    const importOrchestrationService = { importUpload } as unknown as ImportOrchestrationService;

    return new UploadImportController(importOrchestrationService, requestContextService);
  }

  it('should call ImportOrchestrationService.importUpload with the validated filePath, importId, and correlationId, when the payload is valid', async () => {
    const importUpload = vi.fn().mockResolvedValue({
      eventsProcessed: 1,
      validEvents: 1,
      invalidEvents: 0,
      duplicateEvents: 0,
      errorCount: 0,
    });
    const requestContextService = new RequestContextService();
    const controller = buildController(importUpload, requestContextService);

    await requestContextService.run({ correlationId, requestId: correlationId }, async () => {
      await controller.handleUpload(validPayload);
    });

    expect(importUpload).toHaveBeenCalledWith(
      validPayload.filePath,
      validPayload.importId,
      correlationId,
    );
  });

  it('should throw and not call ImportOrchestrationService.importUpload, when the payload fails schema validation', async () => {
    const importUpload = vi.fn();
    const requestContextService = new RequestContextService();
    const controller = buildController(importUpload, requestContextService);

    await requestContextService.run({ correlationId, requestId: correlationId }, async () => {
      await expect(controller.handleUpload({ importId: 'not-a-uuid' })).rejects.toThrow();
    });
    expect(importUpload).not.toHaveBeenCalled();
  });
});
