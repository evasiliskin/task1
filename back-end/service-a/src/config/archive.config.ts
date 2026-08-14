import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const archiveConfigSchema = z.object({
  baseUrl: z.url().default('https://data.gharchive.org'),
  downloadTimeoutMs: z.coerce.number().int().positive().default(30_000),
});

export type ArchiveConfiguration = z.infer<typeof archiveConfigSchema>;

export default registerAs('archive', (): ArchiveConfiguration =>
  archiveConfigSchema.parse({
    baseUrl: process.env.GITHUB_ARCHIVE_BASE_URL,
    downloadTimeoutMs: process.env.ARCHIVE_DOWNLOAD_TIMEOUT_MS,
  }),
);
