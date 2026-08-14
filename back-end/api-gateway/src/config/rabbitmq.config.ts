import { registerAs } from '@nestjs/config';
import { requireInProduction } from '@task1/shared';
import { z } from 'zod';

const rabbitmqConfigSchema = z.object({
  url: z.url(),
  serviceBQueue: z.string().min(1).default('service_b_queue'),
  serviceAQueue: z.string().min(1).default('service_a_queue'),
  pingTimeoutMs: z.coerce.number().int().positive().default(3000),
  rpcTimeoutMs: z.coerce.number().int().positive().default(10_000),
});

export type RabbitmqConfiguration = z.infer<typeof rabbitmqConfigSchema>;

export default registerAs('rabbitmq', (): RabbitmqConfiguration =>
  rabbitmqConfigSchema.parse({
    url: requireInProduction(
      process.env.RABBITMQ_URL,
      'RABBITMQ_URL',
      'amqp://guest:guest@localhost:5672',
    ),
    serviceBQueue: process.env.RABBITMQ_SERVICE_B_QUEUE,
    serviceAQueue: process.env.RABBITMQ_SERVICE_A_QUEUE,
    pingTimeoutMs: process.env.RABBITMQ_PING_TIMEOUT_MS,
    rpcTimeoutMs: process.env.RABBITMQ_RPC_TIMEOUT_MS,
  }),
);
