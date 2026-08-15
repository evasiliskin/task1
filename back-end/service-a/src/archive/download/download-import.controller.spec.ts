import { type RmqContext } from '@nestjs/microservices';
import { type LoggerService } from '@task1/shared/logger/logger.service';

import { ImportAlreadyClaimedError } from '../import-claim.error.js';
import { type ImportOrchestrationService } from '../import-orchestration.service.js';

import { DownloadImportController } from './download-import.controller.js';

function buildRmqContext(): RmqContext {
  return {
    getChannelRef: () => ({ ack: vi.fn() }),
    getMessage: () => ({ fields: { deliveryTag: 1 } }),
  } as unknown as RmqContext;
}

describe('DownloadImportController', () => {
  const validPayload = {
    importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    dateHour: '2026-08-11-0',
  };

  function buildController(importDownload: ReturnType<typeof vi.fn>): {
    controller: DownloadImportController;
    infoMock: ReturnType<typeof vi.fn>;
  } {
    const importOrchestrationService = { importDownload } as unknown as ImportOrchestrationService;
    const infoMock = vi.fn();
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ info: infoMock }),
    } as unknown as LoggerService;
    const controller = new DownloadImportController(importOrchestrationService, loggerService);

    return { controller, infoMock };
  }

  it('should call importDownload with the validated dateHour and importId, when the payload is valid', async () => {
    const importDownload = vi.fn().mockResolvedValue({
      eventsProcessed: 1,
      validEvents: 1,
      invalidEvents: 0,
      duplicateEvents: 0,
      errorCount: 0,
    });
    const { controller } = buildController(importDownload);

    await controller.handleDownload(validPayload, buildRmqContext());

    expect(importDownload).toHaveBeenCalledWith(validPayload.dateHour, validPayload.importId);
  });

  it('should swallow ImportAlreadyClaimedError and not rethrow, when another consumer already claimed the import', async () => {
    const importDownload = vi
      .fn()
      .mockRejectedValue(new ImportAlreadyClaimedError('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'));
    const { controller } = buildController(importDownload);

    await expect(
      controller.handleDownload(
        {
          importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          dateHour: '2026-08-11-0',
        },
        buildRmqContext(),
      ),
    ).resolves.toBeUndefined();
  });

  it('should rethrow, when the import fails for any reason other than an existing claim', async () => {
    const importDownload = vi.fn().mockRejectedValue(new Error('archive download failed'));
    const { controller } = buildController(importDownload);

    await expect(
      controller.handleDownload(
        {
          importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          dateHour: '2026-08-11-0',
        },
        buildRmqContext(),
      ),
    ).rejects.toThrow('archive download failed');
  });

  it('should throw, when the payload fails schema validation', async () => {
    const importDownload = vi.fn();
    const { controller } = buildController(importDownload);

    await expect(
      controller.handleDownload({ importId: 'not-a-uuid' }, buildRmqContext()),
    ).rejects.toThrow();
    expect(importDownload).not.toHaveBeenCalled();
  });

  it('should ack the message, even when the handler throws', async () => {
    const ack = vi.fn();
    const context = {
      getChannelRef: () => ({ ack }),
      getMessage: () => ({ fields: { deliveryTag: 1 } }),
    } as unknown as RmqContext;
    const importDownload = vi.fn().mockRejectedValue(new Error('boom'));
    const { controller } = buildController(importDownload);

    await expect(controller.handleDownload(validPayload, context)).rejects.toThrow('boom');
    expect(ack).toHaveBeenCalledTimes(1);
  });
});
