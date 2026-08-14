import { EventSchema } from './event.schema.js';

describe('EventSchema', () => {
  it('should accept a well-formed event without org, when parsed', () => {
    const result = EventSchema.safeParse({
      eventId: 'e1',
      eventType: 'PushEvent',
      createdAt: '2026-08-11T00:00:00.000Z',
      actor: { id: 1, login: 'octocat' },
      repo: { id: 2, name: 'octocat/hello-world' },
      importId: 'import-1',
      payload: { ref: 'refs/heads/main', commitCount: 1 },
    });

    expect(result.success).toBe(true);
  });

  it('should accept a well-formed event with org, when parsed', () => {
    const result = EventSchema.safeParse({
      eventId: 'e1',
      eventType: 'PushEvent',
      createdAt: '2026-08-11T00:00:00.000Z',
      actor: { id: 1, login: 'octocat' },
      repo: { id: 2, name: 'octocat/hello-world' },
      org: { id: 3, login: 'octo-org' },
      importId: 'import-1',
      payload: {},
    });

    expect(result.success).toBe(true);
  });

  it('should reject an event missing repo, when parsed', () => {
    const result = EventSchema.safeParse({
      eventId: 'e1',
      eventType: 'PushEvent',
      createdAt: '2026-08-11T00:00:00.000Z',
      actor: { id: 1, login: 'octocat' },
      importId: 'import-1',
      payload: {},
    });

    expect(result.success).toBe(false);
  });
});
