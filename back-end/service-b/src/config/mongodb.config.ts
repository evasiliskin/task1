import { registerAs } from '@nestjs/config';
import { requireInProduction } from '@task1/shared';
import { z } from 'zod';

const THIRTY_DAYS_MS = 2_592_000_000;

const mongodbConfigSchema = z.object({
  uri: z.url(),
  processingLogRetentionMs: z.coerce.number().int().positive().default(THIRTY_DAYS_MS),
});

export type MongodbConfiguration = z.infer<typeof mongodbConfigSchema>;

export default registerAs('mongodb', (): MongodbConfiguration =>
  mongodbConfigSchema.parse({
    uri: requireInProduction(
      process.env.MONGODB_URI,
      'MONGODB_URI',
      'mongodb://localhost:27017/service_b',
    ),
    processingLogRetentionMs: process.env.PROCESSING_LOG_RETENTION_MS,
  }),
);
