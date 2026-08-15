import { z } from 'zod';

// `correlationId` is deliberately absent: it travels on the AMQP `x-correlation-id` header and is
// read from RequestContextService by the consumer. Carrying it in the payload as well produced two
// divergent values for the same operation.
export const importFailedEventSchema = z.object({
  importId: z.uuid(),
  archive: z.string().min(1),
  startedAt: z.iso.datetime(),
  failedAt: z.iso.datetime(),
  reason: z.string().min(1),
});

export type ImportFailedEvent = z.infer<typeof importFailedEventSchema>;
