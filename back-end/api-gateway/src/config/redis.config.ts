import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const redisConfigSchema = z.object({
  url: z.url().default('redis://localhost:6379'),
  pingTimeoutMs: z.coerce.number().int().positive().default(3000),
});

export type RedisConfiguration = z.infer<typeof redisConfigSchema>;

export default registerAs('redis', (): RedisConfiguration =>
  redisConfigSchema.parse({
    url: process.env.REDIS_URL,
    pingTimeoutMs: process.env.REDIS_PING_TIMEOUT_MS,
  }),
);
