import { z } from 'zod';

import { EventSchema } from './event.schema.js';

export const SearchEventsResponseSchema = z.object({
  data: z.array(EventSchema),
  nextCursor: z.string().optional(),
});

export type SearchEventsResponse = z.infer<typeof SearchEventsResponseSchema>;
