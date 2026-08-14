import { type RmqContext } from '@nestjs/microservices';

import { ackMessage } from './rmq-ack.util.js';

describe('ackMessage', () => {
  it('should ack the current message on the current channel', () => {
    const ack = vi.fn();
    const message = { fields: { deliveryTag: 1 } };
    const context = {
      getChannelRef: () => ({ ack }),
      getMessage: () => message,
    } as unknown as RmqContext;

    ackMessage(context);

    expect(ack).toHaveBeenCalledWith(message);
  });
});
