import { registerAs } from '@nestjs/config';
import { requireInProduction } from '@task1/shared';
import { z } from 'zod';

const rabbitmqConfigSchema = z.object({
  url: z.url(),
  queue: z.string().min(1).default('service_a_queue'),
  serviceBQueue: z.string().min(1).default('service_b_queue'),
  prefetchCount: z.coerce.number().int().positive().default(2),
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
    serviceBQueue: process.env.RABBITMQ_SERVICE_B_QUEUE,
    prefetchCount: process.env.RABBITMQ_PREFETCH_COUNT,
  }),
);
