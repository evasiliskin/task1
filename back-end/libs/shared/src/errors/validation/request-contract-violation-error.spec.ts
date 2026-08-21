import { ErrorCategory } from '../error-category.enum.js';

import { RequestContractViolationError } from './request-contract-violation-error.js';

describe('RequestContractViolationError', () => {
  it('should carry the VALIDATION category, REQUEST_CONTRACT_VIOLATION code, and the field errors, when constructed', () => {
    const fieldErrors = [{ field: 'limit', errorType: 'TOO_BIG', message: 'Too big' }];
    const error = new RequestContractViolationError({
      controllerName: 'EventsController',
      methodName: 'search',
      fieldErrors,
    });

    expect(error.category).toBe(ErrorCategory.VALIDATION);
    expect(error.code).toBe('REQUEST_CONTRACT_VIOLATION');
    expect(error.fieldErrors).toEqual(fieldErrors);
    expect(error.params).toEqual({
      controllerName: 'EventsController',
      methodName: 'search',
    });
  });

  it('should use a client-safe message that omits controller and method names, when constructed', () => {
    const error = new RequestContractViolationError({
      controllerName: 'EventsController',
      methodName: 'search',
      fieldErrors: [],
    });

    expect(error.message).toBe('Request validation failed');
    expect(error.message).not.toContain('EventsController');
  });
});
