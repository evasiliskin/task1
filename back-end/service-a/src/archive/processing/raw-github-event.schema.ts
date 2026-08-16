import { z } from 'zod';

const rawGithubActorSchema = z.object({
  id: z.number().int(),
  login: z.string().min(1),
});

const rawGithubRepositorySchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
});

export const rawGithubEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  created_at: z.iso.datetime(),
  actor: rawGithubActorSchema,
  repo: rawGithubRepositorySchema,
  org: rawGithubActorSchema.optional(),
  // `z.unknown()`, not `z.record(...)`: a record schema validates and deep-copies the whole GitHub
  // payload for every line, and `buildPayload` then keeps two or three fields. That copy was the
  // largest allocation cost of an import. `buildPayload` guards every field it reads.
  payload: z.unknown(),
});

export type RawGithubEvent = z.infer<typeof rawGithubEventSchema>;
