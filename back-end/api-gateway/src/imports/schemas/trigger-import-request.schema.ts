import { z } from 'zod';

const DATE_HOUR_PATTERN = /^\d{4}-\d{2}-\d{2}-([0-9]|1[0-9]|2[0-3])$/;

export const TriggerImportRequestSchema = z.object({
  body: z
    .object({
      dateHour: z.string().regex(DATE_HOUR_PATTERN, 'dateHour must match YYYY-MM-DD-H (hour 0-23)'),
    })
    .strict(),
});

export type TriggerImportRequest = z.infer<typeof TriggerImportRequestSchema>;
