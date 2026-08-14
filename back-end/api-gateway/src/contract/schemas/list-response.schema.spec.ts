import { isListResult } from '@task1/shared/exception-handling/http/list-result';
import { z } from 'zod';

import { listResponseSchema } from './list-response.schema.js';

const ItemSchema = z.object({ id: z.string() });

describe('listResponseSchema', () => {
  it('should return a branded list result, when parsing a valid payload', () => {
    const { schema } = listResponseSchema(ItemSchema);

    const parsed = schema.parse({ items: [{ id: '1' }], pagination: { nextCursor: 'abc' } });

    expect(isListResult(parsed)).toBe(true);
  });

  it('should preserve items and pagination, when parsing a valid payload', () => {
    const { schema } = listResponseSchema(ItemSchema);

    const parsed = schema.parse({ items: [{ id: '1' }], pagination: { nextCursor: 'abc' } });

    expect(parsed).toMatchObject({ items: [{ id: '1' }], pagination: { nextCursor: 'abc' } });
  });

  it('should accept an absent nextCursor, when the page is the last one', () => {
    const { schema } = listResponseSchema(ItemSchema);

    const parsed = schema.parse({ items: [], pagination: {} });

    expect(isListResult(parsed)).toBe(true);
  });

  it('should reject the payload, when an item does not match the item schema', () => {
    const { schema } = listResponseSchema(ItemSchema);

    expect(() => schema.parse({ items: [{ id: 42 }], pagination: {} })).toThrow();
  });

  it('should expose a shape that converts to JSON Schema, when generating Swagger docs', () => {
    const { shape } = listResponseSchema(ItemSchema);

    expect(() => z.toJSONSchema(shape)).not.toThrow();
  });
});
