import { ErrorCategory } from '../error-category.enum.js';

import { RequestContractViolationError } from './request-contract-violation-error.js';

describe('RequestContractViolationError', () => {
  it('should carry the VALIDATION category, REQUEST_CONTRACT_VIOLATION code, and the zod errors, when constructed', () => {
    const errors = { message: 'invalid' };
    const error = new RequestContractViolationError({
      controllerName: 'EventsController',
      methodName: 'search',
      errors,
    });

    expect(error.category).toBe(ErrorCategory.VALIDATION);
    expect(error.code).toBe('REQUEST_CONTRACT_VIOLATION');
    expect(error.params).toEqual({
      controllerName: 'EventsController',
      methodName: 'search',
      errors,
    });
  });
});
