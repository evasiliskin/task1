import { registerAs } from '@nestjs/config';
import { requireInProduction } from '@task1/shared';
import { z } from 'zod';

const reportConfigSchema = z.object({
  dir: z.string().min(1),
});

export type ReportConfiguration = z.infer<typeof reportConfigSchema>;

export default registerAs('report', (): ReportConfiguration =>
  reportConfigSchema.parse({
    dir: requireInProduction(process.env.REPORT_DIR, 'REPORT_DIR', './data/reports'),
  }),
);
