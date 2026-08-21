import { z } from 'zod';

export const EmptyRequestSchema = z.object({}).strict();

export type EmptyRequest = z.infer<typeof EmptyRequestSchema>;
