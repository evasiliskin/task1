import { z } from 'zod';

export const UploadImportResponseSchema = z.object({
  importId: z.string().uuid(),
});

export type UploadImportResponse = z.infer<typeof UploadImportResponseSchema>;
