import { buildEventsFilter } from './build-events-filter.js';

describe('buildEventsFilter', () => {
  const baseMessage = { limit: 50 };

  it('should return an empty filter, when no filters or cursor are provided', () => {
    expect(buildEventsFilter(baseMessage)).toEqual({});
  });

  it('should filter by eventType, when type is provided', () => {
    expect(buildEventsFilter({ ...baseMessage, type: 'PushEvent' })).toEqual({
      eventType: 'PushEvent',
    });
  });

  it('should filter by repo.name, when repository is provided', () => {
    expect(buildEventsFilter({ ...baseMessage, repository: 'octocat/hello-world' })).toEqual({
      'repo.name': 'octocat/hello-world',
    });
  });

  it('should filter by actor.login, when actor is provided', () => {
    expect(buildEventsFilter({ ...baseMessage, actor: 'octocat' })).toEqual({
      'actor.login': 'octocat',
    });
  });

  it('should filter by importId, when importId is provided', () => {
    expect(
      buildEventsFilter({ ...baseMessage, importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' }),
    ).toEqual({
      importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    });
  });

  it('should filter createdAt with only $gte, when only from is provided', () => {
    expect(buildEventsFilter({ ...baseMessage, from: '2026-08-01T00:00:00.000Z' })).toEqual({
      createdAt: { $gte: new Date('2026-08-01T00:00:00.000Z') },
    });
  });

  it('should filter createdAt with both $gte and $lte, when from and to are both provided', () => {
    expect(
      buildEventsFilter({
        ...baseMessage,
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-11T00:00:00.000Z',
      }),
    ).toEqual({
      createdAt: {
        $gte: new Date('2026-08-01T00:00:00.000Z'),
        $lte: new Date('2026-08-11T00:00:00.000Z'),
      },
    });
  });

  it('should combine every provided filter field, when all are present', () => {
    expect(
      buildEventsFilter({
        ...baseMessage,
        type: 'PushEvent',
        repository: 'octocat/hello-world',
        actor: 'octocat',
        importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      }),
    ).toEqual({
      eventType: 'PushEvent',
      'repo.name': 'octocat/hello-world',
      'actor.login': 'octocat',
      importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    });
  });

  it('should wrap the filter in a keyset $and/$or clause, when a cursor is provided', () => {
    const cursor = { createdAt: new Date('2026-08-11T00:00:00.000Z'), eventId: '48291832741' };

    expect(buildEventsFilter({ ...baseMessage, type: 'PushEvent' }, cursor)).toEqual({
      $and: [
        { eventType: 'PushEvent' },
        {
          $or: [
            { createdAt: { $lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, eventId: { $lt: cursor.eventId } },
          ],
        },
      ],
    });
  });
});
