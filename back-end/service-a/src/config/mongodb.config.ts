import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const mongodbConfigSchema = z.object({
  uri: z.url().default('mongodb://localhost:27017/service_a'),
  batchSize: z.coerce.number().int().positive().default(500),
});

export type MongodbConfiguration = z.infer<typeof mongodbConfigSchema>;

export default registerAs('mongodb', (): MongodbConfiguration =>
  mongodbConfigSchema.parse({
    uri: process.env.MONGODB_URI,
    batchSize: process.env.MONGO_BATCH_SIZE,
  }),
);
