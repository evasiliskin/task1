import { z } from 'zod';

export const uploadImportMessageSchema = z.object({
  importId: z.uuid(),
  filePath: z.string().min(1),
});

export type UploadImportMessage = z.infer<typeof uploadImportMessageSchema>;
