import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const rabbitmqConfigSchema = z.object({
  url: z.url().default('amqp://guest:guest@localhost:5672'),
  queue: z.string().min(1).default('service_b_queue'),
  prefetchCount: z.coerce.number().int().positive().default(10),
  maxRetries: z.coerce.number().int().positive().default(5),
  deadLetterQueue: z.string().min(1).default('service_b_queue.dlq'),
});

export type RabbitmqConfiguration = z.infer<typeof rabbitmqConfigSchema>;

export default registerAs('rabbitmq', (): RabbitmqConfiguration =>
  rabbitmqConfigSchema.parse({
    url: process.env.RABBITMQ_URL,
    queue: process.env.RABBITMQ_QUEUE,
    prefetchCount: process.env.RABBITMQ_PREFETCH_COUNT,
    maxRetries: process.env.RABBITMQ_MAX_RETRIES,
    deadLetterQueue: process.env.RABBITMQ_DEAD_LETTER_QUEUE,
  }),
);
