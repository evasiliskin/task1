import { listResult } from '@task1/shared/pagination/list-result';
import { z, type ZodTypeAny } from 'zod';

const PaginationSchema = z.object({ nextCursor: z.string().optional() });

export function listResponseSchema<TItem extends ZodTypeAny>(itemSchema: TItem) {
  const shape = z.object({
    items: z.array(itemSchema),
    pagination: PaginationSchema,
  });

  const schema = shape.transform((value) => listResult(value.items, value.pagination));

  return { shape, schema };
}
