import { z } from 'zod';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const SearchEventsRequestSchema = z.object({
  query: z
    .object({
      type: z.string().optional(),
      repository: z.string().optional(),
      actor: z.string().optional(),
      from: z.iso.datetime().optional(),
      to: z.iso.datetime().optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
    })
    .strict()
    .prefault({}),
});

export type SearchEventsRequest = z.infer<typeof SearchEventsRequestSchema>;
