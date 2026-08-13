import { z } from 'zod';

export const generateReportMessageSchema = z.object({
  importId: z.uuid().optional(),
});

export type GenerateReportMessage = z.infer<typeof generateReportMessageSchema>;
