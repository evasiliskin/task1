import { type IApiPagination } from '../api-response/api-response.types.js';

const LIST_RESULT = Symbol('LIST_RESULT');

export interface IListResult<T> {
  readonly [LIST_RESULT]: true;
  readonly items: readonly T[];
  readonly pagination: IApiPagination;
}

export function listResult<T>(items: readonly T[], pagination: IApiPagination): IListResult<T> {
  return { [LIST_RESULT]: true, items, pagination };
}

export function isListResult(value: unknown): value is IListResult<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    // eslint-disable-next-line security/detect-object-injection -- LIST_RESULT is a module-local Symbol constant, not user-controlled input.
    (value as Partial<IListResult<unknown>>)[LIST_RESULT] === true
  );
}
