import { type RawGithubEvent } from './raw-github-event.schema.js';
import { transformEvent } from './transform-event.js';

describe('transformEvent', () => {
  const baseEvent: RawGithubEvent = {
    id: '1',
    type: 'PushEvent',
    created_at: '2026-08-11T00:00:00Z',
    actor: { id: 1, login: 'octocat' },
    repo: { id: 2, name: 'octocat/hello-world' },
    payload: {},
  };

  it('should map eventId, eventType, actor, repo, and importId directly, when transforming any event', () => {
    const document = transformEvent(baseEvent, 'import-1');

    expect(document.eventId).toBe('1');
    expect(document.eventType).toBe('PushEvent');
    expect(document.actor).toEqual({ id: 1, login: 'octocat' });
    expect(document.repo).toEqual({ id: 2, name: 'octocat/hello-world' });
    expect(document.importId).toBe('import-1');
  });

  it('should parse createdAt into a real Date, when transforming any event', () => {
    const document = transformEvent(baseEvent, 'import-1');

    expect(document.createdAt).toBeInstanceOf(Date);
    expect(document.createdAt.toISOString()).toBe('2026-08-11T00:00:00.000Z');
  });

  it('should include org, when the raw event has one', () => {
    const document = transformEvent(
      { ...baseEvent, org: { id: 9, login: 'octo-org' } },
      'import-1',
    );

    expect(document.org).toEqual({ id: 9, login: 'octo-org' });
  });

  it('should omit org entirely, when the raw event has none', () => {
    const document = transformEvent(baseEvent, 'import-1');

    expect('org' in document).toBe(false);
  });

  it('should whitelist ref and commitCount, when eventType is PushEvent', () => {
    const event: RawGithubEvent = {
      ...baseEvent,
      payload: { ref: 'refs/heads/main', commits: [{ sha: 'a' }, { sha: 'b' }] },
    };

    expect(transformEvent(event, 'import-1').payload).toEqual({
      ref: 'refs/heads/main',
      commitCount: 2,
    });
  });

  it('should default ref to an empty string and commitCount to 0, when PushEvent payload lacks them', () => {
    const event: RawGithubEvent = { ...baseEvent, payload: {} };

    expect(transformEvent(event, 'import-1').payload).toEqual({ ref: '', commitCount: 0 });
  });

  it('should whitelist action and issueTitle, when eventType is IssuesEvent', () => {
    const event: RawGithubEvent = {
      ...baseEvent,
      type: 'IssuesEvent',
      payload: { action: 'opened', issue: { title: 'Something is broken' } },
    };

    expect(transformEvent(event, 'import-1').payload).toEqual({
      action: 'opened',
      issueTitle: 'Something is broken',
    });
  });

  it('should truncate issueTitle to 200 characters, when the title is longer', () => {
    const longTitle = 'x'.repeat(250);
    const event: RawGithubEvent = {
      ...baseEvent,
      type: 'IssuesEvent',
      payload: { action: 'opened', issue: { title: longTitle } },
    };

    expect(transformEvent(event, 'import-1').payload.issueTitle).toBe(longTitle.slice(0, 200));
  });

  it('should default action to an empty string and issueTitle to an empty string, when IssuesEvent payload lacks them', () => {
    const event: RawGithubEvent = { ...baseEvent, type: 'IssuesEvent', payload: {} };

    expect(transformEvent(event, 'import-1').payload).toEqual({ action: '', issueTitle: '' });
  });

  it('should produce an empty payload, when eventType is not explicitly whitelisted', () => {
    const event: RawGithubEvent = {
      ...baseEvent,
      type: 'WatchEvent',
      payload: { action: 'started' },
    };

    expect(transformEvent(event, 'import-1').payload).toEqual({});
  });

  it('should produce an empty push payload when the raw payload is not an object', () => {
    const document = transformEvent(
      {
        id: '1',
        type: 'PushEvent',
        created_at: '2026-08-11T00:00:00Z',
        actor: { id: 1, login: 'octocat' },
        repo: { id: 2, name: 'octocat/hello-world' },
        payload: null,
      },
      'import-1',
    );

    expect(document.payload).toEqual({ ref: '', commitCount: 0 });
  });
});
