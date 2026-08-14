import { listResult } from '@task1/shared/pagination/list-result';
import { z, type ZodTypeAny } from 'zod';

const PaginationSchema = z.object({ nextCursor: z.string().optional() });

/**
 * Builds a list endpoint's response contract.
 *
 * `ContractValidationInterceptor` returns `parsed.data` — a new object built by Zod — so a
 * brand applied by the controller would be stripped during validation. The `.transform()`
 * below re-applies it, keeping item validation and the list brand composable.
 *
 * `shape` is the pre-transform schema: `z.toJSONSchema()` cannot represent a transform's
 * output, so Swagger generation must use `shape`, never `schema`.
 */
export function listResponseSchema<TItem extends ZodTypeAny>(itemSchema: TItem) {
  const shape = z.object({
    items: z.array(itemSchema),
    pagination: PaginationSchema,
  });

  const schema = shape.transform((value) => listResult(value.items, value.pagination));

  return { shape, schema };
}
