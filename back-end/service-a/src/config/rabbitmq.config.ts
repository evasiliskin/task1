import { registerAs } from '@nestjs/config';
import { requireInProduction } from '@task1/shared';
import { z } from 'zod';

const TEN_MINUTES_MS = 600_000;

const rabbitmqConfigSchema = z.object({
  url: z.url(),
  queue: z.string().min(1).default('service_a_queue'),
  importsQueue: z.string().min(1).default('service_a_imports_queue'),
  serviceBQueue: z.string().min(1).default('service_b_queue'),
  rpcPrefetch: z.coerce.number().int().positive().default(20),
  importPrefetch: z.coerce.number().int().positive().default(2),
  maxRetries: z.coerce.number().int().positive().default(5),
  retryDelayMs: z.coerce.number().int().positive().default(5000),
  maxRetryDelayMs: z.coerce.number().int().positive().default(TEN_MINUTES_MS),
});

export type RabbitmqConfiguration = z.infer<typeof rabbitmqConfigSchema>;

export default registerAs('rabbitmq', (): RabbitmqConfiguration =>
  rabbitmqConfigSchema.parse({
    url: requireInProduction(
      process.env.RABBITMQ_URL,
      'RABBITMQ_URL',
      'amqp://guest:guest@localhost:5672',
    ),
    queue: process.env.RABBITMQ_QUEUE,
    importsQueue: process.env.RABBITMQ_IMPORTS_QUEUE,
    serviceBQueue: process.env.RABBITMQ_SERVICE_B_QUEUE,
    rpcPrefetch: process.env.RABBITMQ_RPC_PREFETCH,
    importPrefetch: process.env.RABBITMQ_IMPORT_PREFETCH,
    maxRetries: process.env.RABBITMQ_MAX_RETRIES,
    retryDelayMs: process.env.RABBITMQ_RETRY_DELAY_MS,
    maxRetryDelayMs: process.env.RABBITMQ_MAX_RETRY_DELAY_MS,
  }),
);
