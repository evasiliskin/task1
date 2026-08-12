import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const storageConfigSchema = z.object({
  dir: z.string().min(1).default('./data/archives'),
});

export type StorageConfiguration = z.infer<typeof storageConfigSchema>;

export default registerAs('storage', (): StorageConfiguration =>
  storageConfigSchema.parse({
    dir: process.env.STORAGE_DIR,
  }),
);
