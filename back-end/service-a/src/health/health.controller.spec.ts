import { type RmqContext } from '@nestjs/microservices';
import { TerminusModule } from '@nestjs/terminus';
import { Test, type TestingModule } from '@nestjs/testing';

import { HealthController } from './health.controller.js';

function buildRmqContext(): RmqContext {
  return {
    getChannelRef: () => ({ ack: vi.fn() }),
    getMessage: () => ({ fields: { deliveryTag: 1 } }),
  } as unknown as RmqContext;
}

describe('HealthController', () => {
  let controller: HealthController;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  describe('check', () => {
    it('should return ok health check result, when health.check message is handled', async () => {
      const result = await controller.check(buildRmqContext());

      expect(result).toEqual({
        status: 'ok',
        info: {},
        error: {},
        details: {},
      });
    });

    it('should ack the message, even when the handler throws', async () => {
      const ack = vi.fn();
      const context = {
        getChannelRef: () => ({ ack }),
        getMessage: () => ({ fields: { deliveryTag: 1 } }),
      } as unknown as RmqContext;
      const brokenController = new HealthController({
        check: vi.fn().mockRejectedValue(new Error('boom')),
      } as never);

      await expect(brokenController.check(context)).rejects.toThrow('boom');
      expect(ack).toHaveBeenCalledTimes(1);
    });
  });
});
