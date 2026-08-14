import { ErrorCategory } from '../error-category.enum.js';

import { ResponseContractViolationError } from './response-contract-violation-error.js';

describe('ResponseContractViolationError', () => {
  it('should carry the INTERNAL category, RESPONSE_CONTRACT_VIOLATION code, and the zod errors, when constructed', () => {
    const errors = { message: 'invalid' };
    const error = new ResponseContractViolationError({
      controllerName: 'StatsController',
      methodName: 'getStats',
      errors,
    });

    expect(error.category).toBe(ErrorCategory.INTERNAL);
    expect(error.code).toBe('RESPONSE_CONTRACT_VIOLATION');
    expect(error.params).toEqual({
      controllerName: 'StatsController',
      methodName: 'getStats',
      errors,
    });
  });
});
