import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const rabbitmqConfigSchema = z.object({
  url: z.url().default('amqp://guest:guest@localhost:5672'),
  serviceBQueue: z.string().min(1).default('service_b_queue'),
  serviceAQueue: z.string().min(1).default('service_a_queue'),
  pingTimeoutMs: z.coerce.number().int().positive().default(3000),
});

export type RabbitmqConfiguration = z.infer<typeof rabbitmqConfigSchema>;

export default registerAs('rabbitmq', (): RabbitmqConfiguration =>
  rabbitmqConfigSchema.parse({
    url: process.env.RABBITMQ_URL,
    serviceBQueue: process.env.RABBITMQ_SERVICE_B_QUEUE,
    serviceAQueue: process.env.RABBITMQ_SERVICE_A_QUEUE,
    pingTimeoutMs: process.env.RABBITMQ_PING_TIMEOUT_MS,
  }),
);
