import { registerAs } from '@nestjs/config';
import { z } from 'zod';

/** GH Archive hourly files decompress to roughly 0.5–2 GB; 4 GiB leaves headroom without being unbounded. */
const DEFAULT_MAX_DECOMPRESSED_BYTES = 4_294_967_296;
/** One JSON event is a few KB at most. 1 MiB is generous and still bounds a newline-free file. */
const DEFAULT_MAX_LINE_BYTES = 1_048_576;

const archiveConfigSchema = z.object({
  baseUrl: z.url().default('https://data.gharchive.org'),
  downloadTimeoutMs: z.coerce.number().int().positive().default(30_000),
  downloadTotalTimeoutMs: z.coerce.number().int().positive().default(600_000),
  downloadMaxAttempts: z.coerce.number().int().positive().default(3),
  downloadRetryDelayMs: z.coerce.number().int().positive().default(2000),
  maxDecompressedBytes: z.coerce.number().int().positive().default(DEFAULT_MAX_DECOMPRESSED_BYTES),
  maxLineBytes: z.coerce.number().int().positive().default(DEFAULT_MAX_LINE_BYTES),
  shutdownDrainTimeoutMs: z.coerce.number().int().positive().default(60_000),
});

export type ArchiveConfiguration = z.infer<typeof archiveConfigSchema>;

export default registerAs('archive', (): ArchiveConfiguration =>
  archiveConfigSchema.parse({
    baseUrl: process.env.GITHUB_ARCHIVE_BASE_URL,
    downloadTimeoutMs: process.env.ARCHIVE_DOWNLOAD_TIMEOUT_MS,
    downloadTotalTimeoutMs: process.env.ARCHIVE_DOWNLOAD_TOTAL_TIMEOUT_MS,
    downloadMaxAttempts: process.env.ARCHIVE_DOWNLOAD_MAX_ATTEMPTS,
    downloadRetryDelayMs: process.env.ARCHIVE_DOWNLOAD_RETRY_DELAY_MS,
    maxDecompressedBytes: process.env.ARCHIVE_MAX_DECOMPRESSED_BYTES,
    maxLineBytes: process.env.ARCHIVE_MAX_LINE_BYTES,
    shutdownDrainTimeoutMs: process.env.SHUTDOWN_DRAIN_TIMEOUT_MS,
  }),
);
