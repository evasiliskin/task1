import { type RmqContext } from '@nestjs/microservices';

import { ClaimImportController } from './claim-import.controller.js';

function buildContext(ack = vi.fn()): RmqContext {
  return {
    getChannelRef: () => ({ ack }),
    getMessage: () => ({ content: Buffer.from('{}'), properties: {} }),
  } as unknown as RmqContext;
}

describe('ClaimImportController', () => {
  it('should return the claimed importId, when the key is valid', async () => {
    const claim = vi.fn().mockResolvedValue({ importId: '11111111-1111-4111-8111-111111111111' });
    const controller = new ClaimImportController({ claim } as never);

    await expect(controller.handleClaim({ idempotencyKey: 'k' }, buildContext())).resolves.toEqual({
      importId: '11111111-1111-4111-8111-111111111111',
    });
    expect(claim).toHaveBeenCalledWith('k');
  });

  it('should ack the message, even when the claim throws', async () => {
    const ack = vi.fn();
    const controller = new ClaimImportController({
      claim: vi.fn().mockRejectedValue(new Error('mongo down')),
    } as never);

    await expect(
      controller.handleClaim({ idempotencyKey: 'k' }, buildContext(ack)),
    ).rejects.toThrow();
    expect(ack).toHaveBeenCalled();
  });

  it('should throw, when the payload has no idempotency key', async () => {
    const controller = new ClaimImportController({ claim: vi.fn() } as never);

    await expect(controller.handleClaim({}, buildContext())).rejects.toBeDefined();
  });
});
