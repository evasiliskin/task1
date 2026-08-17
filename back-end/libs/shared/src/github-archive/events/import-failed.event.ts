import { z } from 'zod';

export const importFailedEventSchema = z.object({
  importId: z.uuid(),
  archive: z.string().min(1),
  startedAt: z.iso.datetime(),
  failedAt: z.iso.datetime(),
  reason: z.string().min(1),
});

export type ImportFailedEvent = z.infer<typeof importFailedEventSchema>;
