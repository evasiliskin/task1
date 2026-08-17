import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const healthConfigSchema = z.object({
  pingTimeoutMs: z.coerce.number().int().positive().default(3000),
});

export type HealthConfiguration = z.infer<typeof healthConfigSchema>;

export default registerAs('health', (): HealthConfiguration =>
  healthConfigSchema.parse({
    pingTimeoutMs: process.env.HEALTH_PING_TIMEOUT_MS,
  }),
);
