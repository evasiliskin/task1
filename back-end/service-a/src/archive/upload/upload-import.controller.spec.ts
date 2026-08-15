import { type RmqContext } from '@nestjs/microservices';
import { type LoggerService } from '@task1/shared/logger/logger.service';

import { ImportAlreadyClaimedError } from '../import-claim.error.js';
import { type ImportOrchestrationService } from '../import-orchestration.service.js';

import { UploadImportController } from './upload-import.controller.js';

function buildRmqContext(): RmqContext {
  return {
    getChannelRef: () => ({ ack: vi.fn() }),
    getMessage: () => ({ fields: { deliveryTag: 1 } }),
  } as unknown as RmqContext;
}

describe('UploadImportController', () => {
  const validPayload = {
    importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    filePath: '/data/archives/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.json.gz',
  };

  function buildController(importUpload: ReturnType<typeof vi.fn>): {
    controller: UploadImportController;
    infoMock: ReturnType<typeof vi.fn>;
  } {
    const importOrchestrationService = { importUpload } as unknown as ImportOrchestrationService;
    const infoMock = vi.fn();
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ info: infoMock }),
    } as unknown as LoggerService;
    const controller = new UploadImportController(importOrchestrationService, loggerService);

    return { controller, infoMock };
  }

  it('should call ImportOrchestrationService.importUpload with the validated filePath and importId, when the payload is valid', async () => {
    const importUpload = vi.fn().mockResolvedValue({
      eventsProcessed: 1,
      validEvents: 1,
      invalidEvents: 0,
      duplicateEvents: 0,
      errorCount: 0,
    });
    const { controller } = buildController(importUpload);

    await controller.handleUpload(validPayload, buildRmqContext());

    expect(importUpload).toHaveBeenCalledWith(validPayload.filePath, validPayload.importId);
  });

  it('should swallow ImportAlreadyClaimedError and not rethrow, when another consumer already claimed the import', async () => {
    const importUpload = vi
      .fn()
      .mockRejectedValue(new ImportAlreadyClaimedError('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'));
    const { controller } = buildController(importUpload);

    await expect(
      controller.handleUpload(
        {
          importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          filePath: '/data/archives/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.json.gz',
        },
        buildRmqContext(),
      ),
    ).resolves.toBeUndefined();
  });

  it('should rethrow, when the import fails for any reason other than an existing claim', async () => {
    const importUpload = vi.fn().mockRejectedValue(new Error('archive upload failed'));
    const { controller } = buildController(importUpload);

    await expect(
      controller.handleUpload(
        {
          importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          filePath: '/data/archives/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.json.gz',
        },
        buildRmqContext(),
      ),
    ).rejects.toThrow('archive upload failed');
  });

  it('should throw and not call ImportOrchestrationService.importUpload, when the payload fails schema validation', async () => {
    const importUpload = vi.fn();
    const { controller } = buildController(importUpload);

    await expect(
      controller.handleUpload({ importId: 'not-a-uuid' }, buildRmqContext()),
    ).rejects.toThrow();
    expect(importUpload).not.toHaveBeenCalled();
  });

  it('should ack the message, even when the handler throws', async () => {
    const ack = vi.fn();
    const context = {
      getChannelRef: () => ({ ack }),
      getMessage: () => ({ fields: { deliveryTag: 1 } }),
    } as unknown as RmqContext;
    const importUpload = vi.fn().mockRejectedValue(new Error('boom'));
    const { controller } = buildController(importUpload);

    await expect(controller.handleUpload(validPayload, context)).rejects.toThrow('boom');
    expect(ack).toHaveBeenCalledTimes(1);
  });
});
