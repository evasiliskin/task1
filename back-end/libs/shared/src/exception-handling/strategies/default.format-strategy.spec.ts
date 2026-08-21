import { HttpStatus } from '@nestjs/common';

import { DefaultFormatStrategy } from './default.format-strategy.js';

describe('DefaultFormatStrategy', () => {
  const strategy = new DefaultFormatStrategy();

  describe('canHandle', () => {
    it('should return true, when the exception is an Error', () => {
      expect(strategy.canHandle(new Error('boom'))).toBe(true);
    });

    it('should return true, when the exception is a thrown non-Error value', () => {
      expect(strategy.canHandle('boom')).toBe(true);
    });

    it('should return true, when the exception is undefined', () => {
      expect(strategy.canHandle(undefined)).toBe(true);
    });
  });

  describe('format', () => {
    it('should return a 500 with an opaque INTERNAL_ERROR body, when the exception is an Error', () => {
      expect(strategy.format(new Error('connection string leaked here'))).toEqual({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    });

    it('should return the same opaque body, when the exception is a thrown non-Error value', () => {
      expect(strategy.format('boom')).toEqual(strategy.format(new Error('boom')));
    });
  });
});
