import { DUPLICATE_KEY_ERROR_CODE } from './duplicate-key.const.js';

describe('DUPLICATE_KEY_ERROR_CODE', () => {
  it("should be MongoDB's E11000 code, when the constant is read", () => {
    expect(DUPLICATE_KEY_ERROR_CODE).toBe(11_000);
  });
});
