import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const healthConfigSchema = z.object({
  pingTimeoutMs: z.coerce.number().int().positive().default(3000),
});

export type HealthConfiguration = z.infer<typeof healthConfigSchema>;

/**
 * Bounds how long a dependency ping may take before the dependency is reported down.
 *
 * Its own config rather than a field on the Redis config: the same budget applies to the MongoDB
 * ping, and a health concern does not belong inside a Redis concern.
 */
export default registerAs('health', (): HealthConfiguration =>
  healthConfigSchema.parse({
    pingTimeoutMs: process.env.HEALTH_PING_TIMEOUT_MS,
  }),
);
