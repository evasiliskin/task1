import { toEventView } from './to-event-view.js';

const DOCUMENT = {
  eventId: 'e1',
  eventType: 'PushEvent',
  createdAt: new Date('2026-08-11T00:00:00.000Z'),
  actor: { id: 1, login: 'octocat' },
  repo: { id: 2, name: 'octocat/hello-world' },
  importId: '11111111-1111-4111-8111-111111111111',
  payload: { ref: 'refs/heads/main', commitCount: 2 },
};

describe('toEventView', () => {
  it('should serialise createdAt as an ISO string', () => {
    expect(toEventView(DOCUMENT).createdAt).toBe('2026-08-11T00:00:00.000Z');
  });

  it('should produce the same JSON the raw document produced', () => {
    expect(JSON.stringify(toEventView(DOCUMENT))).toBe(JSON.stringify(DOCUMENT));
  });

  it('should include org only when present', () => {
    expect(toEventView(DOCUMENT)).not.toHaveProperty('org');
    expect(toEventView({ ...DOCUMENT, org: { id: 3, login: 'acme' } })).toHaveProperty('org', {
      id: 3,
      login: 'acme',
    });
  });
});
