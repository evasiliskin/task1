import { z } from 'zod';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const LOG_STATUSES = ['started', 'completed', 'failed', 'dead-lettered'] as const;

export const SearchLogsRequestSchema = z.object({
  query: z
    .object({
      importId: z.string().uuid().optional(),
      status: z.enum(LOG_STATUSES).optional(),
      from: z.iso.datetime().optional(),
      to: z.iso.datetime().optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
    })
    .strict()
    .prefault({}),
});

export type SearchLogsRequest = z.infer<typeof SearchLogsRequestSchema>;
