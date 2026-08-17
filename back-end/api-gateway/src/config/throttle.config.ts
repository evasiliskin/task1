import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const throttleConfigSchema = z.object({
  ttlMs: z.coerce.number().int().positive().default(60_000),
  limit: z.coerce.number().int().positive().default(100),
  uploadLimit: z.coerce.number().int().positive().default(5),
});

export type ThrottleConfiguration = z.infer<typeof throttleConfigSchema>;

export default registerAs('throttle', (): ThrottleConfiguration =>
  throttleConfigSchema.parse({
    ttlMs: process.env.THROTTLE_TTL_MS,
    limit: process.env.THROTTLE_LIMIT,
    uploadLimit: process.env.THROTTLE_UPLOAD_LIMIT,
  }),
);
