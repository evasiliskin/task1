import { z } from 'zod';

export const GetStatsRequestSchema = z.object({
  query: z
    .object({
      importId: z.string().uuid().optional(),
    })
    .strict()
    .prefault({}),
});

export type GetStatsRequest = z.infer<typeof GetStatsRequestSchema>;
