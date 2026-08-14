import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const mongodbConfigSchema = z.object({
  uri: z.url().default('mongodb://localhost:27017/gateway'),
  pingTimeoutMs: z.coerce.number().int().positive().default(3000),
});

export type MongodbConfiguration = z.infer<typeof mongodbConfigSchema>;

export default registerAs('mongodb', (): MongodbConfiguration =>
  mongodbConfigSchema.parse({
    uri: process.env.MONGODB_URI,
    pingTimeoutMs: process.env.MONGODB_PING_TIMEOUT_MS,
  }),
);
