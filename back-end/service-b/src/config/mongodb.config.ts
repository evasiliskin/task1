import { registerAs } from '@nestjs/config';
import { requireInProduction } from '@task1/shared';
import { z } from 'zod';

const mongodbConfigSchema = z.object({
  uri: z.url(),
});

export type MongodbConfiguration = z.infer<typeof mongodbConfigSchema>;

export default registerAs('mongodb', (): MongodbConfiguration =>
  mongodbConfigSchema.parse({
    uri: requireInProduction(
      process.env.MONGODB_URI,
      'MONGODB_URI',
      'mongodb://localhost:27017/service_b',
    ),
  }),
);
