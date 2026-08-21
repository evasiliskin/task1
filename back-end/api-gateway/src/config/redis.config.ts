import { registerAs } from '@nestjs/config';
import { requireInProduction } from '@task1/shared';
import { z } from 'zod';

const redisConfigSchema = z.object({
  url: z.url(),
  pingTimeoutMs: z.coerce.number().int().positive().default(3000),
});

export type RedisConfiguration = z.infer<typeof redisConfigSchema>;

export default registerAs('redis', (): RedisConfiguration =>
  redisConfigSchema.parse({
    url: requireInProduction(process.env.REDIS_URL, 'REDIS_URL', 'redis://localhost:6379'),
    pingTimeoutMs: process.env.REDIS_PING_TIMEOUT_MS,
  }),
);
