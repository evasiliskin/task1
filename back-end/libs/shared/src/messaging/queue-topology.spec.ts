import { buildRetryQueueArguments, deriveQueueTopology } from './queue-topology.js';

describe('deriveQueueTopology', () => {
  it('should derive the retry and dead-letter names from the main queue, when given a queue name', () => {
    expect(deriveQueueTopology('service_a_imports_queue')).toEqual({
      main: 'service_a_imports_queue',
      retry: 'service_a_imports_queue.retry',
      deadLetter: 'service_a_imports_queue.dlq',
    });
  });

  it('should keep the three names distinct, when given a queue name that already ends in .retry', () => {
    const topology = deriveQueueTopology('service_a_imports_queue.retry');

    expect(new Set(Object.values(topology)).size).toBe(3);
  });
});

describe('buildRetryQueueArguments', () => {
  it('should dead-letter back to the main queue over the default exchange, when given a queue name', () => {
    expect(buildRetryQueueArguments('service_a_imports_queue')).toEqual({
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': 'service_a_imports_queue',
    });
  });

  it('should not set a queue-level TTL, when the arguments are built', () => {
    expect(buildRetryQueueArguments('service_a_imports_queue')).not.toHaveProperty('x-message-ttl');
  });
});
