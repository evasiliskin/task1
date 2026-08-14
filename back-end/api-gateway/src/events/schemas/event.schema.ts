import { z } from 'zod';

const GithubActorSchema = z.object({ id: z.number(), login: z.string() });
const GithubRepositorySchema = z.object({ id: z.number(), name: z.string() });
const GithubOrganizationSchema = z.object({ id: z.number(), login: z.string() });

export const EventSchema = z.object({
  eventId: z.string(),
  eventType: z.string(),
  createdAt: z.string(),
  actor: GithubActorSchema,
  repo: GithubRepositorySchema,
  org: GithubOrganizationSchema.optional(),
  importId: z.string(),
  payload: z.record(z.string(), z.unknown()),
});

export type EventView = z.infer<typeof EventSchema>;
