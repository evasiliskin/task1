import { z } from 'zod';

export const TriggerImportResponseSchema = z.object({
  importId: z.string().uuid(),
});

export type TriggerImportResponse = z.infer<typeof TriggerImportResponseSchema>;
