import { registerAs } from '@nestjs/config';
import { requireInProduction } from '@task1/shared';
import { z } from 'zod';

const SEVEN_DAYS_MS = 604_800_000;

const redisConfigSchema = z.object({
  url: z.url(),
  metricsRetentionMs: z.coerce.number().int().positive().default(SEVEN_DAYS_MS),
});

export type RedisConfiguration = z.infer<typeof redisConfigSchema>;

export default registerAs('redis', (): RedisConfiguration =>
  redisConfigSchema.parse({
    url: requireInProduction(process.env.REDIS_URL, 'REDIS_URL', 'redis://localhost:6379'),
    metricsRetentionMs: process.env.REDIS_METRICS_RETENTION_MS,
  }),
);
