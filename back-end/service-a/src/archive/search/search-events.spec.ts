import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type Collection } from 'mongodb';

import { encodeEventCursor } from './event-cursor.util.js';
import { searchEvents } from './search-events.js';

describe('searchEvents', () => {
  function buildDocument(eventId: string, createdAt: string): IGithubEventDocument {
    return {
      eventId,
      eventType: 'PushEvent',
      createdAt: new Date(createdAt),
      actor: { id: 1, login: 'octocat' },
      repo: { id: 2, name: 'octocat/hello-world' },
      importId: 'import-1',
      payload: {},
    };
  }

  function buildCollection(documents: IGithubEventDocument[]): {
    collection: Collection<IGithubEventDocument>;
    find: ReturnType<typeof vi.fn>;
    cursor: { sort: ReturnType<typeof vi.fn>; limit: ReturnType<typeof vi.fn> };
  } {
    const cursor = {
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(documents),
    };
    const find = vi.fn().mockReturnValue(cursor);

    return { collection: { find } as unknown as Collection<IGithubEventDocument>, find, cursor };
  }

  it('should return every document and no nextCursor, when fewer documents exist than the limit', async () => {
    const documents = [buildDocument('e1', '2026-08-11T00:02:00.000Z')];
    const { collection } = buildCollection(documents);

    const result = await searchEvents(collection, { limit: 50 });

    expect(result).toEqual({ data: documents });
  });

  it('should return a nextCursor derived from the last returned document, when more documents exist than the limit', async () => {
    const documents = [
      buildDocument('e1', '2026-08-11T00:02:00.000Z'),
      buildDocument('e2', '2026-08-11T00:01:00.000Z'),
      buildDocument('e3', '2026-08-11T00:00:00.000Z'),
    ];
    const { collection } = buildCollection(documents);

    const result = await searchEvents(collection, { limit: 2 });

    expect(result.data).toEqual(documents.slice(0, 2));
    expect(result.nextCursor).toBe(
      encodeEventCursor({
        createdAt: documents[1]?.createdAt,
        eventId: documents[1]?.eventId,
      }),
    );
  });

  it('should query with limit + 1, sorted by createdAt/eventId descending, excluding _id, when called', async () => {
    const { collection, find, cursor } = buildCollection([]);

    await searchEvents(collection, { limit: 50 });

    expect(find).toHaveBeenCalledWith({}, { projection: { _id: 0 } });
    expect(cursor.sort).toHaveBeenCalledWith({ createdAt: -1, eventId: -1 });
    expect(cursor.limit).toHaveBeenCalledWith(51);
  });

  it('should decode the cursor and build a keyset filter, when a cursor is provided', async () => {
    const { collection, find } = buildCollection([]);
    const priorCreatedAt = new Date('2026-08-11T00:00:00.000Z');
    const priorCursor = encodeEventCursor({ createdAt: priorCreatedAt, eventId: 'e3' });

    await searchEvents(collection, { limit: 50, cursor: priorCursor });

    expect(find).toHaveBeenCalledWith(
      {
        $and: [
          {},
          {
            $or: [
              { createdAt: { $lt: priorCreatedAt } },
              { createdAt: priorCreatedAt, eventId: { $lt: 'e3' } },
            ],
          },
        ],
      },
      { projection: { _id: 0 } },
    );
  });
});
