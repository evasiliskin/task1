import { registerAs } from '@nestjs/config';
import { requireInProduction } from '@task1/shared';
import { z } from 'zod';

const rabbitmqConfigSchema = z.object({
  url: z.url(),
  queue: z.string().min(1).default('service_b_queue'),
  prefetchCount: z.coerce.number().int().positive().default(10),
  maxRetries: z.coerce.number().int().positive().default(5),
  deadLetterQueue: z.string().min(1).default('service_b_queue.dlq'),
  retryQueue: z.string().min(1).default('service_b_queue.retry'),
  retryDelayMs: z.coerce.number().int().positive().default(5000),
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
    prefetchCount: process.env.RABBITMQ_PREFETCH_COUNT,
    maxRetries: process.env.RABBITMQ_MAX_RETRIES,
    deadLetterQueue: process.env.RABBITMQ_DEAD_LETTER_QUEUE,
    retryQueue: process.env.RABBITMQ_RETRY_QUEUE,
    retryDelayMs: process.env.RABBITMQ_RETRY_DELAY_MS,
  }),
);
