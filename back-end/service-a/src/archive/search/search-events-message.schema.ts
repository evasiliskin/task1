import { z } from 'zod';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export const searchEventsMessageSchema = z.object({
  type: z.string().min(1).optional(),
  repository: z.string().min(1).optional(),
  actor: z.string().min(1).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

export type SearchEventsMessage = z.infer<typeof searchEventsMessageSchema>;
