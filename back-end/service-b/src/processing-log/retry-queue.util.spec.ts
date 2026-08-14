import { buildRetryQueueArguments } from './retry-queue.util.js';

describe('buildRetryQueueArguments', () => {
  it('should expire messages back onto the main queue via the default exchange after the configured delay', () => {
    expect(buildRetryQueueArguments('service_b_queue', 5000)).toEqual({
      'x-message-ttl': 5000,
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': 'service_b_queue',
    });
  });
});
