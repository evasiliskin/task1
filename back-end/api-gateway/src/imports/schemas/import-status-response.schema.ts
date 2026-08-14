import { z } from 'zod';

const ImportStatusSourceSchema = z.object({
  type: z.enum(['download', 'upload']),
  archive: z.string().optional(),
  filename: z.string().optional(),
});

export const ImportStatusResponseSchema = z.object({
  importId: z.string(),
  source: ImportStatusSourceSchema,
  status: z.enum(['started', 'completed', 'failed']),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  failedAt: z.string().optional(),
  eventsProcessed: z.number().optional(),
  validEvents: z.number().optional(),
  invalidEvents: z.number().optional(),
  duplicateEvents: z.number().optional(),
  errorCount: z.number().optional(),
  errorSamples: z.array(z.string()).optional(),
});

export type ImportStatusResponse = z.infer<typeof ImportStatusResponseSchema>;
