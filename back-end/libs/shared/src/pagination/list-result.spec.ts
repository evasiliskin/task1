import { isListResult, listResult } from './list-result.js';

describe('listResult', () => {
  it('should expose items and pagination, when built from a factory call', () => {
    const result = listResult([{ id: '1' }], { nextCursor: 'abc' });

    expect(result.items).toEqual([{ id: '1' }]);
    expect(result.pagination).toEqual({ nextCursor: 'abc' });
  });
});

describe('isListResult', () => {
  it('should return true, when the value came from listResult', () => {
    expect(isListResult(listResult([], {}))).toBe(true);
  });

  it('should return false, when the value is a structural look-alike without the brand', () => {
    expect(isListResult({ items: [], pagination: {} })).toBe(false);
  });

  it('should return false, when the value is a plain object', () => {
    expect(isListResult({ importId: 'a28ec884-d2ec-4871-93fa-b63e8c52537f' })).toBe(false);
  });

  it('should return false, when the value is null', () => {
    expect(isListResult(null)).toBe(false);
  });

  it('should return false, when the value is a bare array', () => {
    expect(isListResult([{ id: '1' }])).toBe(false);
  });
});
