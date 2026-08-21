import { registerAs } from '@nestjs/config';
import { requireInProduction } from '@task1/shared';
import { z } from 'zod';

const ONE_HOUR_MS = 3_600_000;
const TEN_MINUTES_MS = 600_000;

const reportConfigSchema = z.object({
  dir: z.string().min(1),
  retentionMs: z.coerce.number().int().positive().default(ONE_HOUR_MS),
  sweepIntervalMs: z.coerce.number().int().positive().default(TEN_MINUTES_MS),
});

export type ReportConfiguration = z.infer<typeof reportConfigSchema>;

export default registerAs('report', (): ReportConfiguration =>
  reportConfigSchema.parse({
    dir: requireInProduction(process.env.REPORT_DIR, 'REPORT_DIR', './data/reports'),
    retentionMs: process.env.REPORT_RETENTION_MS,
    sweepIntervalMs: process.env.REPORT_SWEEP_INTERVAL_MS,
  }),
);
