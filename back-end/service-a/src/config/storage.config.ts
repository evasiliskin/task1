import { registerAs } from '@nestjs/config';
import { requireInProduction } from '@task1/shared';
import { z } from 'zod';

const storageConfigSchema = z.object({
  dir: z.string().min(1),
});

export type StorageConfiguration = z.infer<typeof storageConfigSchema>;

export default registerAs('storage', (): StorageConfiguration =>
  storageConfigSchema.parse({
    dir: requireInProduction(process.env.STORAGE_DIR, 'STORAGE_DIR', './data/archives'),
  }),
);
