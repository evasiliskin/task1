import { ErrorFormatService } from './error-format.service.js';
import {
  type IErrorFormatStrategy,
  type IFormattedError,
} from './error-format.strategy.interface.js';

function strategy(canHandle: boolean, result: IFormattedError): IErrorFormatStrategy {
  return {
    canHandle: () => canHandle,
    format: () => result,
  };
}

describe('ErrorFormatService', () => {
  it('should format with the first matching strategy, when several strategies are registered', () => {
    const matching: IFormattedError = {
      statusCode: 404,
      error: { code: 'NOT_FOUND', category: 'NOT_FOUND', message: 'missing' },
    };
    const service = new ErrorFormatService([
      strategy(false, { statusCode: 0, error: { code: 'X', category: 'X', message: 'X' } }),
      strategy(true, matching),
    ]);

    const result = service.format(new Error('boom'));

    expect(result).toBe(matching);
  });

  it('should fall back to the last strategy, when no strategy can handle the exception', () => {
    const fallback: IFormattedError = {
      statusCode: 500,
      error: { code: 'INTERNAL_ERROR', category: 'INTERNAL', message: 'unexpected' },
    };
    const service = new ErrorFormatService([
      strategy(false, { statusCode: 0, error: { code: 'X', category: 'X', message: 'X' } }),
      strategy(false, fallback),
    ]);

    const result = service.format('anything');

    expect(result).toBe(fallback);
  });
});
