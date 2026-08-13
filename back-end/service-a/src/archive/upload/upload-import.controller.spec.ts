import { type ArchiveProcessingService } from './archive-processing.service.js';
import { UploadImportController } from './upload-import.controller.js';

describe('UploadImportController', () => {
  const validPayload = {
    importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    filePath: '/data/archives/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.json.gz',
  };

  it('should call ArchiveProcessingService.process with the validated filePath and importId, when the payload is valid', async () => {
    const process = vi.fn().mockResolvedValue({
      eventsProcessed: 1,
      validEvents: 1,
      invalidEvents: 0,
      duplicateEvents: 0,
      errorCount: 0,
    });
    const archiveProcessingService = { process } as unknown as ArchiveProcessingService;
    const controller = new UploadImportController(archiveProcessingService);

    await controller.handleUpload(validPayload);

    expect(process).toHaveBeenCalledWith(validPayload.filePath, validPayload.importId);
  });

  it('should throw and not call ArchiveProcessingService.process, when the payload fails schema validation', async () => {
    const process = vi.fn();
    const archiveProcessingService = { process } as unknown as ArchiveProcessingService;
    const controller = new UploadImportController(archiveProcessingService);

    await expect(controller.handleUpload({ importId: 'not-a-uuid' })).rejects.toThrow();
    expect(process).not.toHaveBeenCalled();
  });
});
