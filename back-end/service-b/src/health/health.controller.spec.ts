import { type RmqContext } from '@nestjs/microservices';
import { TerminusModule } from '@nestjs/terminus';
import { Test, type TestingModule } from '@nestjs/testing';

import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let controller: HealthController;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  function buildContext(): {
    context: RmqContext;
    message: Record<string, unknown>;
    ack: ReturnType<typeof vi.fn>;
  } {
    const message = { content: Buffer.from('{}'), properties: { headers: {} } };
    const ack = vi.fn();
    const context = {
      getChannelRef: vi.fn().mockReturnValue({ ack }),
      getMessage: vi.fn().mockReturnValue(message),
    } as unknown as RmqContext;

    return { context, message, ack };
  }

  describe('check', () => {
    it('should return ok health check result and ack the message, when health.check message is handled', async () => {
      const { context, message, ack } = buildContext();

      const result = await controller.check(context);

      expect(result).toEqual({
        status: 'ok',
        info: {},
        error: {},
        details: {},
      });
      expect(ack).toHaveBeenCalledWith(message);
    });
  });
});
