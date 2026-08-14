import { HttpStatus } from '@nestjs/common';
import { TimeoutError } from 'rxjs';

import { TimeoutErrorFormatStrategy } from './timeout-error.format-strategy.js';

describe('TimeoutErrorFormatStrategy', () => {
  const strategy = new TimeoutErrorFormatStrategy();

  describe('canHandle', () => {
    it('should return true, when the exception is a TimeoutError', () => {
      expect(strategy.canHandle(new TimeoutError())).toBe(true);
    });

    it('should return false, when the exception is a plain Error', () => {
      expect(strategy.canHandle(new Error('boom'))).toBe(false);
    });
  });

  describe('format', () => {
    it('should return a 504 with a GATEWAY_TIMEOUT code, when called', () => {
      const result = strategy.format(new TimeoutError());

      expect(result).toEqual({
        statusCode: HttpStatus.GATEWAY_TIMEOUT,
        error: {
          code: 'GATEWAY_TIMEOUT',
          message: 'The downstream service did not respond in time.',
        },
      });
    });
  });
});
