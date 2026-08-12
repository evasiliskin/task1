import { rawGithubEventSchema } from './raw-github-event.schema.js';

describe('rawGithubEventSchema', () => {
  const validEvent = {
    id: '11111111111',
    type: 'PushEvent',
    created_at: '2026-08-11T00:00:00Z',
    actor: { id: 1, login: 'octocat' },
    repo: { id: 2, name: 'octocat/hello-world' },
    payload: { ref: 'refs/heads/main', commits: [{ sha: 'abc' }] },
  };

  it('should accept a valid event with no org, when org is omitted', () => {
    expect(rawGithubEventSchema.parse(validEvent)).toEqual(validEvent);
  });

  it('should accept a valid event with an org, when org is present', () => {
    const eventWithOrg = { ...validEvent, org: { id: 3, login: 'octo-org' } };

    expect(rawGithubEventSchema.parse(eventWithOrg)).toEqual(eventWithOrg);
  });

  it('should throw, when id is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, ...withoutId } = validEvent;

    expect(() => rawGithubEventSchema.parse(withoutId)).toThrow();
  });

  it('should throw, when type is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { type, ...withoutType } = validEvent;

    expect(() => rawGithubEventSchema.parse(withoutType)).toThrow();
  });

  it('should throw, when created_at is not an ISO datetime string', () => {
    expect(() => rawGithubEventSchema.parse({ ...validEvent, created_at: 'not-a-date' })).toThrow();
  });

  it('should throw, when actor is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { actor, ...withoutActor } = validEvent;

    expect(() => rawGithubEventSchema.parse(withoutActor)).toThrow();
  });

  it('should throw, when repo.name is missing', () => {
    expect(() => rawGithubEventSchema.parse({ ...validEvent, repo: { id: 2 } })).toThrow();
  });

  it('should throw, when payload is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { payload, ...withoutPayload } = validEvent;

    expect(() => rawGithubEventSchema.parse(withoutPayload)).toThrow();
  });
});
