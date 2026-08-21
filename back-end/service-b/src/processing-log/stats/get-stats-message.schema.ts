import { z } from 'zod';

export const getStatsMessageSchema = z.object({
  importId: z.uuid().optional(),
});

export type GetStatsMessage = z.infer<typeof getStatsMessageSchema>;
