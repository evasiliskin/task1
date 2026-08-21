import { z } from 'zod';

export const downloadImportMessageSchema = z.object({
  importId: z.uuid(),
  dateHour: z.string().min(1),
});

export type DownloadImportMessage = z.infer<typeof downloadImportMessageSchema>;
