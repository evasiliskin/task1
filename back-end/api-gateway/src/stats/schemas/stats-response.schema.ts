import { z } from 'zod';

const StatsTimeSeriesPointSchema = z.object({
  timestamp: z.string(),
  value: z.number(),
});

export const StatsResponseSchema = z.object({
  archivesProcessed: z.number(),
  eventsProcessed: z.number(),
  successfulEvents: z.number(),
  invalidEvents: z.number(),
  errors: z.number(),
  processingDurationMs: z.number().optional(),
  timeSeries: z.array(StatsTimeSeriesPointSchema),
});

export type StatsResponse = z.infer<typeof StatsResponseSchema>;
