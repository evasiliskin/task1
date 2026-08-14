import { z } from 'zod';

import { listResponseSchema } from '../../contract/schemas/list-response.schema.js';

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

const { shape, schema } = listResponseSchema(LogEntrySchema);

export const SearchLogsResultShape = shape;
export const SearchLogsResponseSchema = schema;

export type SearchLogsResponse = z.infer<typeof SearchLogsResponseSchema>;
export type LogEntry = z.infer<typeof LogEntrySchema>;
