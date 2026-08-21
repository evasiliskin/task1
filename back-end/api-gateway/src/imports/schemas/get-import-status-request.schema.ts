import { z } from 'zod';

export const GetImportStatusRequestSchema = z.object({
  params: z
    .object({
      importId: z.string().uuid(),
    })
    .strict(),
});

export type GetImportStatusRequest = z.infer<typeof GetImportStatusRequestSchema>;
