import { z } from 'zod';

export const GetReportRequestSchema = z.object({
  query: z
    .object({
      importId: z.string().uuid().optional(),
    })
    .strict()
    .prefault({}),
});

export type GetReportRequest = z.infer<typeof GetReportRequestSchema>;
