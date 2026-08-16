import { type RmqContext } from '@nestjs/microservices';
import { type LoggerService } from '@task1/shared/logger/logger.service';
import { type RetryPublisher } from '@task1/shared/messaging/retry-publisher';

import { ImportAlreadyClaimedError } from '../import-claim.error.js';
import { type ImportOrchestrationService } from '../import-orchestration.service.js';

import { UploadImportController } from './upload-import.controller.js';

function buildRmqContext(ack: ReturnType<typeof vi.fn> = vi.fn()): RmqContext {
  return {
    getChannelRef: () => ({ ack, nack: vi.fn() }),
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
    retryPublisher: RetryPublisher;
  } {
    const importOrchestrationService = { importUpload } as unknown as ImportOrchestrationService;
    const retryPublisher = {
      settleFailure: vi.fn().mockResolvedValue('retried'),
    } as unknown as RetryPublisher;
    const infoMock = vi.fn();
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ info: infoMock, warn: vi.fn(), error: vi.fn() }),
    } as unknown as LoggerService;
    const controller = new UploadImportController(
      importOrchestrationService,
      retryPublisher,
      loggerService,
    );

    return { controller, infoMock, retryPublisher };
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

  it('should ack and not retry, when another consumer already claimed the import', async () => {
    const importUpload = vi
      .fn()
      .mockRejectedValue(new ImportAlreadyClaimedError('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'));
    const { controller, retryPublisher } = buildController(importUpload);
    const ack = vi.fn();

    await controller.handleUpload(validPayload, buildRmqContext(ack));

    expect(ack).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(retryPublisher.settleFailure).not.toHaveBeenCalled();
  });

  it('should delegate to RetryPublisher and not ack, when the import fails for any other reason', async () => {
    const importUpload = vi.fn().mockRejectedValue(new Error('archive upload failed'));
    const { controller, retryPublisher } = buildController(importUpload);
    const ack = vi.fn();

    await controller.handleUpload(validPayload, buildRmqContext(ack));

    expect(ack).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(retryPublisher.settleFailure).toHaveBeenCalledTimes(1);
  });

  it('should ack without importing, when the payload fails schema validation', async () => {
    const importUpload = vi.fn();
    const { controller, retryPublisher } = buildController(importUpload);
    const ack = vi.fn();

    await controller.handleUpload({ importId: 'not-a-uuid' }, buildRmqContext(ack));

    expect(importUpload).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(retryPublisher.settleFailure).not.toHaveBeenCalled();
  });
});
