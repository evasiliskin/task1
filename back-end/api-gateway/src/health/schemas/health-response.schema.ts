import { z } from 'zod';

const ServiceStatusSchema = z.enum(['ok', 'unavailable']);

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  services: z.object({
    gateway: ServiceStatusSchema,
    rabbitmq: ServiceStatusSchema,
    serviceA: ServiceStatusSchema,
    serviceB: ServiceStatusSchema,
    redis: ServiceStatusSchema,
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const LivenessResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('gateway'),
});

export type LivenessResponse = z.infer<typeof LivenessResponseSchema>;
