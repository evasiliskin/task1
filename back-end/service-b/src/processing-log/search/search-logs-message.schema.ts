import { z } from 'zod';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export const searchLogsMessageSchema = z.object({
  importId: z.uuid().optional(),
  status: z.enum(['started', 'completed', 'failed']).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

export type SearchLogsMessage = z.infer<typeof searchLogsMessageSchema>;
