import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const DEFAULT_MAX_UPLOAD_FILE_SIZE_BYTES = 536_870_912; // 512 MiB — GH Archive hourly files are 50–150 MB

const uploadConfigSchema = z.object({
  maxFileSizeBytes: z.coerce.number().int().positive().default(DEFAULT_MAX_UPLOAD_FILE_SIZE_BYTES),
});

export type UploadConfiguration = z.infer<typeof uploadConfigSchema>;

export default registerAs('upload', (): UploadConfiguration =>
  uploadConfigSchema.parse({
    maxFileSizeBytes: process.env.UPLOAD_MAX_FILE_SIZE_BYTES,
  }),
);
