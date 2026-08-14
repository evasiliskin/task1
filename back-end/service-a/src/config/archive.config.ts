import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const archiveConfigSchema = z.object({
  baseUrl: z.url().default('https://data.gharchive.org'),
  downloadTimeoutMs: z.coerce.number().int().positive().default(30_000),
  downloadTotalTimeoutMs: z.coerce.number().int().positive().default(600_000),
  downloadMaxAttempts: z.coerce.number().int().positive().default(3),
  downloadRetryDelayMs: z.coerce.number().int().positive().default(2000),
});

export type ArchiveConfiguration = z.infer<typeof archiveConfigSchema>;

export default registerAs('archive', (): ArchiveConfiguration =>
  archiveConfigSchema.parse({
    baseUrl: process.env.GITHUB_ARCHIVE_BASE_URL,
    downloadTimeoutMs: process.env.ARCHIVE_DOWNLOAD_TIMEOUT_MS,
    downloadTotalTimeoutMs: process.env.ARCHIVE_DOWNLOAD_TOTAL_TIMEOUT_MS,
    downloadMaxAttempts: process.env.ARCHIVE_DOWNLOAD_MAX_ATTEMPTS,
    downloadRetryDelayMs: process.env.ARCHIVE_DOWNLOAD_RETRY_DELAY_MS,
  }),
);
