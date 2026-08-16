import { type RmqContext } from '@nestjs/microservices';
import { type LoggerService } from '@task1/shared/logger/logger.service';
import { type RetryPublisher } from '@task1/shared/messaging/retry-publisher';

import { ImportAlreadyClaimedError } from '../import-claim.error.js';
import { type ImportOrchestrationService } from '../import-orchestration.service.js';

import { DownloadImportController } from './download-import.controller.js';

function buildRmqContext(ack: ReturnType<typeof vi.fn> = vi.fn()): RmqContext {
  return {
    getChannelRef: () => ({ ack, nack: vi.fn() }),
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
    retryPublisher: RetryPublisher;
  } {
    const importOrchestrationService = { importDownload } as unknown as ImportOrchestrationService;
    const retryPublisher = {
      settleFailure: vi.fn().mockResolvedValue('retried'),
    } as unknown as RetryPublisher;
    const infoMock = vi.fn();
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ info: infoMock, warn: vi.fn(), error: vi.fn() }),
    } as unknown as LoggerService;
    const controller = new DownloadImportController(
      importOrchestrationService,
      retryPublisher,
      loggerService,
    );

    return { controller, infoMock, retryPublisher };
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

  it('should ack and not retry, when another consumer already claimed the import', async () => {
    const importDownload = vi
      .fn()
      .mockRejectedValue(new ImportAlreadyClaimedError('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'));
    const { controller, retryPublisher } = buildController(importDownload);
    const ack = vi.fn();

    await controller.handleDownload(validPayload, buildRmqContext(ack));

    expect(ack).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(retryPublisher.settleFailure).not.toHaveBeenCalled();
  });

  it('should delegate to RetryPublisher and not ack, when the import fails for any other reason', async () => {
    const importDownload = vi.fn().mockRejectedValue(new Error('archive download failed'));
    const { controller, retryPublisher } = buildController(importDownload);
    const ack = vi.fn();

    await controller.handleDownload(validPayload, buildRmqContext(ack));

    expect(ack).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(retryPublisher.settleFailure).toHaveBeenCalledTimes(1);
  });

  it('should ack without importing, when the payload fails schema validation', async () => {
    const importDownload = vi.fn();
    const { controller, retryPublisher } = buildController(importDownload);
    const ack = vi.fn();

    await controller.handleDownload({ importId: 'not-a-uuid' }, buildRmqContext(ack));

    expect(importDownload).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(retryPublisher.settleFailure).not.toHaveBeenCalled();
  });
});
