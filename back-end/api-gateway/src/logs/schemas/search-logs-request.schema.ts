import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@task1/shared';
import { z } from 'zod';

const LOG_STATUSES = ['started', 'completed', 'failed', 'dead-lettered'] as const;

export const SearchLogsRequestSchema = z.object({
  query: z
    .object({
      importId: z.string().uuid().optional(),
      status: z.enum(LOG_STATUSES).optional(),
      from: z.iso.datetime().optional(),
      to: z.iso.datetime().optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
    })
    .strict()
    .prefault({}),
});

export type SearchLogsRequest = z.infer<typeof SearchLogsRequestSchema>;
