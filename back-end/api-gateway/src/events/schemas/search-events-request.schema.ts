import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@task1/shared';
import { z } from 'zod';

export const SearchEventsRequestSchema = z.object({
  query: z
    .object({
      type: z.string().min(1).optional(),
      repository: z.string().min(1).optional(),
      actor: z.string().min(1).optional(),
      from: z.iso.datetime().optional(),
      to: z.iso.datetime().optional(),
      cursor: z.string().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
    })
    .strict()
    .prefault({}),
});

export type SearchEventsRequest = z.infer<typeof SearchEventsRequestSchema>;
