import { z } from 'zod';

export const importCompletedEventSchema = z.object({
  importId: z.uuid(),
  archive: z.string().min(1),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  eventsProcessed: z.coerce.number().int().nonnegative(),
  validEvents: z.coerce.number().int().nonnegative(),
  invalidEvents: z.coerce.number().int().nonnegative(),
  duplicateEvents: z.coerce.number().int().nonnegative(),
  errorCount: z.coerce.number().int().nonnegative(),
});

export type ImportCompletedEvent = z.infer<typeof importCompletedEventSchema>;
