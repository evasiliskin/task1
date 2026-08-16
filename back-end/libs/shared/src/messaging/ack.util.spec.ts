import { type RmqContext } from '@nestjs/microservices';

import { ackMessage } from './ack.util.js';

describe('ackMessage', () => {
  it('should ack the current message on the current channel', () => {
    const ack = vi.fn();
    const message = { content: Buffer.from('{}'), properties: {} };
    const context = {
      getChannelRef: () => ({ ack }),
      getMessage: () => message,
    } as unknown as RmqContext;

    ackMessage(context);

    expect(ack).toHaveBeenCalledWith(message);
  });
});
