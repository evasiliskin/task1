import { z } from 'zod';

export const importStatusMessageSchema = z.object({
  importId: z.uuid(),
});

export type ImportStatusMessage = z.infer<typeof importStatusMessageSchema>;
