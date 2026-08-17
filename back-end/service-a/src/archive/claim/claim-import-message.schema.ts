import { z } from 'zod';

export const claimImportMessageSchema = z.object({
  idempotencyKey: z.string().min(1).max(200),
});

export type ClaimImportMessage = z.infer<typeof claimImportMessageSchema>;
