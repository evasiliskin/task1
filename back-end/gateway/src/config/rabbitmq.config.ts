import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const rabbitmqConfigSchema = z.object({
  url: z.url().default('amqp://guest:guest@localhost:5672'),
  usersQueue: z.string().min(1).default('users_service_queue'),
  productsQueue: z.string().min(1).default('products_service_queue'),
});

export type RabbitmqConfiguration = z.infer<typeof rabbitmqConfigSchema>;

export default registerAs('rabbitmq', (): RabbitmqConfiguration =>
  rabbitmqConfigSchema.parse({
    url: process.env.RABBITMQ_URL,
    usersQueue: process.env.RABBITMQ_USERS_QUEUE,
    productsQueue: process.env.RABBITMQ_PRODUCTS_QUEUE,
  }),
);
