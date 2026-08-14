import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const reportConfigSchema = z.object({
  dir: z.string().min(1).default('./data/reports'),
});

export type ReportConfiguration = z.infer<typeof reportConfigSchema>;

export default registerAs('report', (): ReportConfiguration =>
  reportConfigSchema.parse({
    dir: process.env.REPORT_DIR,
  }),
);
