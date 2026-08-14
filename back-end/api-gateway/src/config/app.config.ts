import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const appConfigSchema = z.object({
  port: z.coerce.number().int().min(1).max(65535).default(3000),
});

export type AppConfiguration = z.infer<typeof appConfigSchema>;

export default registerAs('app', (): AppConfiguration =>
  appConfigSchema.parse({
    port: process.env.PORT,
  }),
);
