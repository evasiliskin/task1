import { ErrorCategory } from '../error-category.enum.js';

import { MissingContractError } from './missing-contract-error.js';

describe('MissingContractError', () => {
  it('should carry the INTERNAL category and MISSING_CONTRACT code, when constructed', () => {
    const error = new MissingContractError({
      controllerName: 'EventsController',
      methodName: 'search',
    });

    expect(error.category).toBe(ErrorCategory.INTERNAL);
    expect(error.code).toBe('MISSING_CONTRACT');
    expect(error.message).toContain('EventsController.search');
  });

  it('should be an instance of Error, when constructed', () => {
    const error = new MissingContractError({ controllerName: 'X', methodName: 'y' });

    expect(error).toBeInstanceOf(Error);
  });
});
