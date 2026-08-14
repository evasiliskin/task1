import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const SEVEN_DAYS_MS = 604_800_000;

const redisConfigSchema = z.object({
  url: z.url().default('redis://localhost:6379'),
  metricsRetentionMs: z.coerce.number().int().positive().default(SEVEN_DAYS_MS),
});

export type RedisConfiguration = z.infer<typeof redisConfigSchema>;

export default registerAs('redis', (): RedisConfiguration =>
  redisConfigSchema.parse({
    url: process.env.REDIS_URL,
    metricsRetentionMs: process.env.REDIS_METRICS_RETENTION_MS,
  }),
);
