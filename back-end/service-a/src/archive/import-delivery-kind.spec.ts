import { type IRmqMessage } from '@task1/shared/messaging/rmq-channel.types';

import { classifyImportDelivery } from './import-delivery-kind.js';

function buildMessage(headers: Record<string, unknown>, redelivered?: boolean): IRmqMessage {
  return {
    content: Buffer.from('{}'),
    properties: { headers },
    ...(redelivered === undefined ? {} : { fields: { redelivered } }),
  };
}

describe('classifyImportDelivery', () => {
  it('should classify the delivery as fresh, when it carries no retry header and is a first delivery', () => {
    expect(classifyImportDelivery(buildMessage({}, false))).toBe('fresh');
  });

  it('should classify the delivery as fresh, when the broker supplied no delivery fields', () => {
    expect(classifyImportDelivery(buildMessage({}))).toBe('fresh');
  });

  it('should classify the delivery as retry, when RetryPublisher republished it', () => {
    expect(classifyImportDelivery(buildMessage({ 'x-retry-count': 2 }, false))).toBe('retry');
  });

  it('should classify the delivery as redelivery, when the broker redelivered an unacked message', () => {
    expect(classifyImportDelivery(buildMessage({}, true))).toBe('redelivery');
  });

  it('should classify the delivery as redelivery, when a republished copy was also left unacked', () => {
    expect(classifyImportDelivery(buildMessage({ 'x-retry-count': 1 }, true))).toBe('redelivery');
  });
});
