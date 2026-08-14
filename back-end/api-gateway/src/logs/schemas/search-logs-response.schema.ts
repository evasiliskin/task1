import { z } from 'zod';

const LogEntrySchema = z.object({
  importId: z.string(),
  eventType: z.string(),
  service: z.string(),
  status: z.string(),
  timestamp: z.string(),
  correlationId: z.string(),
  archive: z.string(),
  metadata: z.record(z.string(), z.number()),
  errorInfo: z.object({ reason: z.string() }).optional(),
});

export const SearchLogsResponseSchema = z.object({
  data: z.array(LogEntrySchema),
  nextCursor: z.string().optional(),
});

export type SearchLogsResponse = z.infer<typeof SearchLogsResponseSchema>;
export type LogEntry = z.infer<typeof LogEntrySchema>;
