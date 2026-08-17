import { BadRequestException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';

import { HttpExceptionFormatStrategy } from './http-exception.format-strategy.js';

describe('HttpExceptionFormatStrategy', () => {
  const strategy = new HttpExceptionFormatStrategy();

  describe('canHandle', () => {
    it('should return true, when the exception is an HttpException', () => {
      expect(strategy.canHandle(new NotFoundException())).toBe(true);
    });

    it('should return false, when the exception is a plain Error', () => {
      expect(strategy.canHandle(new Error('boom'))).toBe(false);
    });
  });

  describe('format', () => {
    it('should derive the code from the status, when the exception carries a status', () => {
      expect(strategy.format(new NotFoundException())).toMatchObject({
        statusCode: HttpStatus.NOT_FOUND,
        error: { code: 'HTTP_404' },
      });
    });

    it('should use the response body as the message, when the body is a string', () => {
      const exception = new HttpException('Upstream refused', HttpStatus.BAD_GATEWAY);

      expect(strategy.format(exception)).toEqual({
        statusCode: HttpStatus.BAD_GATEWAY,
        error: { code: 'HTTP_502', message: 'Upstream refused' },
      });
    });

    it('should use the message property, when the response body is an object carrying a string message', () => {
      const exception = new BadRequestException('dateHour is required');

      expect(strategy.format(exception).error.message).toBe('dateHour is required');
    });

    it('should join the messages, when the response body carries an array of messages', () => {
      const exception = new BadRequestException(['dateHour is required', 'dateHour is malformed']);

      expect(strategy.format(exception).error.message).toBe(
        'dateHour is required, dateHour is malformed',
      );
    });

    it("should fall back to the exception's own message, when the response body carries no usable message", () => {
      const exception = new HttpException({ statusCode: 418 }, HttpStatus.I_AM_A_TEAPOT);

      expect(strategy.format(exception).error.message).toBe(exception.message);
    });

    it("should fall back to the exception's own message, when the response body is an empty array of messages", () => {
      const exception = new HttpException({ message: [] }, HttpStatus.BAD_REQUEST);

      expect(strategy.format(exception).error.message).toBe(exception.message);
    });
  });
});
