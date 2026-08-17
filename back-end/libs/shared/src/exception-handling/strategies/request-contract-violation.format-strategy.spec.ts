import { RequestContractViolationError } from '../../errors/index.js';

import { RequestContractViolationFormatStrategy } from './request-contract-violation.format-strategy.js';

describe('RequestContractViolationFormatStrategy', () => {
  const strategy = new RequestContractViolationFormatStrategy();

  it('should handle the exception, when it is a RequestContractViolationError', () => {
    const error = new RequestContractViolationError({
      controllerName: 'EventsController',
      methodName: 'search',
      fieldErrors: [],
    });

    expect(strategy.canHandle(error)).toBe(true);
  });

  it('should not handle the exception, when it is a plain error', () => {
    expect(strategy.canHandle(new Error('boom'))).toBe(false);
  });

  it('should format to 400 with the field errors attached, when given a violation', () => {
    const error = new RequestContractViolationError({
      controllerName: 'EventsController',
      methodName: 'search',
      fieldErrors: [
        { field: 'limit', errorType: 'TOO_BIG', message: 'Too big', constraints: { max: 200 } },
      ],
    });

    const formatted = strategy.format(error);

    expect(formatted.statusCode).toBe(400);
    expect(formatted.error.code).toBe('REQUEST_CONTRACT_VIOLATION');
    expect(formatted.error.fieldErrors).toEqual([
      { field: 'limit', errorType: 'TOO_BIG', message: 'Too big', constraints: { max: 200 } },
    ]);
  });

  it('should omit controller and method names from the message, when it formats the violation', () => {
    const error = new RequestContractViolationError({
      controllerName: 'EventsController',
      methodName: 'search',
      fieldErrors: [],
    });

    expect(error.message).toBe('Request validation failed');
    expect(error.message).not.toContain('EventsController');
  });
});
