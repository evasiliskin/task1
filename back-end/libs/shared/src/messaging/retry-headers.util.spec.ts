import { buildRetryHeaders, getRetryCount } from './retry-headers.util.js';
import { type IRmqMessage } from './rmq-channel.types.js';

describe('retryHeadersUtil', () => {
  describe('getRetryCount', () => {
    it('should return 0, when the message has no headers', () => {
      const message: IRmqMessage = { content: Buffer.from('{}'), properties: {} };

      expect(getRetryCount(message)).toBe(0);
    });

    it('should return 0, when the retry-count header is absent', () => {
      const message: IRmqMessage = { content: Buffer.from('{}'), properties: { headers: {} } };

      expect(getRetryCount(message)).toBe(0);
    });

    it('should return the parsed count, when the retry-count header is present', () => {
      const message: IRmqMessage = {
        content: Buffer.from('{}'),
        properties: { headers: { 'x-retry-count': 3 } },
      };

      expect(getRetryCount(message)).toBe(3);
    });

    it('should return 0, when the retry-count header is not a positive number', () => {
      const message: IRmqMessage = {
        content: Buffer.from('{}'),
        properties: { headers: { 'x-retry-count': 'not-a-number' } },
      };

      expect(getRetryCount(message)).toBe(0);
    });
  });

  describe('buildRetryHeaders', () => {
    it('should merge existing headers with the new retry count, when called', () => {
      const message: IRmqMessage = {
        content: Buffer.from('{}'),
        properties: { headers: { 'x-request-id': 'abc' } },
      };

      expect(buildRetryHeaders(message, 2)).toEqual({ 'x-request-id': 'abc', 'x-retry-count': 2 });
    });

    it('should return only the retry count, when the message has no existing headers', () => {
      const message: IRmqMessage = { content: Buffer.from('{}'), properties: {} };

      expect(buildRetryHeaders(message, 1)).toEqual({ 'x-retry-count': 1 });
    });
  });
});
