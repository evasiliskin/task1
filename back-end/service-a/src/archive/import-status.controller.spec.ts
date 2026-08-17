import { type RmqContext } from '@nestjs/microservices';

import { type ImportRunTracker } from './import-run-tracker.service.js';
import { type IImportRunDocument } from './import-run.types.js';
import { ImportStatusController } from './import-status.controller.js';
import { toImportStatusView } from './to-import-status-view.js';

function buildRmqContext(): RmqContext {
  return {
    getChannelRef: () => ({ ack: vi.fn() }),
    getMessage: () => ({ fields: { deliveryTag: 1 } }),
  } as unknown as RmqContext;
}

describe('ImportStatusController', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  function buildDocument(): IImportRunDocument {
    return {
      importId,
      source: { type: 'download', archive: '2026-08-11-0.json.gz' },
      status: 'completed',
      startedAt: new Date('2026-08-11T00:00:00.000Z'),
      completedAt: new Date('2026-08-11T00:05:00.000Z'),
    };
  }

  it('should validate the payload and delegate to ImportRunTracker.findByImportId, when a valid message is received', async () => {
    const document = buildDocument();
    const findByImportId = vi.fn().mockResolvedValue(document);
    const importRunTracker = { findByImportId } as unknown as ImportRunTracker;
    const controller = new ImportStatusController(importRunTracker);

    const result = await controller.handleGetStatus({ importId }, buildRmqContext());

    expect(result).toEqual(toImportStatusView(document));
    expect(findByImportId).toHaveBeenCalledWith(importId);
  });

  it('should return null, when no import run matches', async () => {
    const findByImportId = vi.fn().mockResolvedValue(null);
    const importRunTracker = { findByImportId } as unknown as ImportRunTracker;
    const controller = new ImportStatusController(importRunTracker);

    await expect(controller.handleGetStatus({ importId }, buildRmqContext())).resolves.toBeNull();
  });

  it('should reject and not call findByImportId, when the payload fails schema validation', async () => {
    const findByImportId = vi.fn();
    const importRunTracker = { findByImportId } as unknown as ImportRunTracker;
    const controller = new ImportStatusController(importRunTracker);

    await expect(
      controller.handleGetStatus({ importId: 'not-a-uuid' }, buildRmqContext()),
    ).rejects.toThrow();
    expect(findByImportId).not.toHaveBeenCalled();
  });

  it('should ack the message, even when the handler throws an error', async () => {
    const ack = vi.fn();
    const context = {
      getChannelRef: () => ({ ack }),
      getMessage: () => ({ fields: { deliveryTag: 1 } }),
    } as unknown as RmqContext;
    const findByImportId = vi.fn().mockRejectedValue(new Error('boom'));
    const importRunTracker = { findByImportId } as unknown as ImportRunTracker;
    const controller = new ImportStatusController(importRunTracker);

    await expect(controller.handleGetStatus({ importId }, context)).rejects.toThrow('boom');
    expect(ack).toHaveBeenCalledTimes(1);
  });
});
