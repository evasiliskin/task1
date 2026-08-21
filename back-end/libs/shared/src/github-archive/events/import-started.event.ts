import { z } from 'zod';

export const importStartedEventSchema = z.object({
  importId: z.uuid(),
  archive: z.string().min(1),
  startedAt: z.iso.datetime(),
});

export type ImportStartedEvent = z.infer<typeof importStartedEventSchema>;
