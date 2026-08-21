import { registerAs } from '@nestjs/config';
import { requireInProduction } from '@task1/shared';
import { z } from 'zod';

const mongodbConfigSchema = z.object({
  uri: z.url(),
  batchSize: z.coerce.number().int().positive().default(500),
  insertConcurrency: z.coerce.number().int().positive().max(8).default(2),
});

export type MongodbConfiguration = z.infer<typeof mongodbConfigSchema>;

export default registerAs('mongodb', (): MongodbConfiguration =>
  mongodbConfigSchema.parse({
    uri: requireInProduction(
      process.env.MONGODB_URI,
      'MONGODB_URI',
      'mongodb://localhost:27017/service_a',
    ),
    batchSize: process.env.MONGO_BATCH_SIZE,
    insertConcurrency: process.env.MONGO_INSERT_CONCURRENCY,
  }),
);
