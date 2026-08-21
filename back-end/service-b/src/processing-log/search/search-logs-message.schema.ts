import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@task1/shared';
import { z } from 'zod';

export const searchLogsMessageSchema = z.object({
  importId: z.uuid().optional(),
  status: z.enum(['started', 'completed', 'failed', 'dead-lettered']).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
});

export type SearchLogsMessage = z.infer<typeof searchLogsMessageSchema>;
