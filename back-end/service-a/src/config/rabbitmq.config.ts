import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const rabbitmqConfigSchema = z.object({
  url: z.url().default('amqp://guest:guest@localhost:5672'),
  queue: z.string().min(1).default('service_a_queue'),
  serviceBQueue: z.string().min(1).default('service_b_queue'),
});

export type RabbitmqConfiguration = z.infer<typeof rabbitmqConfigSchema>;

export default registerAs('rabbitmq', (): RabbitmqConfiguration =>
  rabbitmqConfigSchema.parse({
    url: process.env.RABBITMQ_URL,
    queue: process.env.RABBITMQ_QUEUE,
    serviceBQueue: process.env.RABBITMQ_SERVICE_B_QUEUE,
  }),
);
