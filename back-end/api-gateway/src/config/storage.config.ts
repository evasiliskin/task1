import { registerAs } from '@nestjs/config';
import { requireInProduction } from '@task1/shared';
import { z } from 'zod';

const ONE_DAY_MS = 86_400_000;
const FIFTEEN_MINUTES_MS = 900_000;
const MIN_UPLOAD_RETENTION_MS = 600_000;

const storageConfigSchema = z.object({
  dir: z.string().min(1),
  uploadRetentionMs: z.coerce.number().int().min(MIN_UPLOAD_RETENTION_MS).default(ONE_DAY_MS),
  uploadSweepIntervalMs: z.coerce.number().int().positive().default(FIFTEEN_MINUTES_MS),
});

export type StorageConfiguration = z.infer<typeof storageConfigSchema>;

export default registerAs('storage', (): StorageConfiguration =>
  storageConfigSchema.parse({
    dir: requireInProduction(process.env.STORAGE_DIR, 'STORAGE_DIR', './data/archives'),
    uploadRetentionMs: process.env.UPLOAD_RETENTION_MS,
    uploadSweepIntervalMs: process.env.UPLOAD_SWEEP_INTERVAL_MS,
  }),
);
