import { ObjectId, type Collection, type WithId } from 'mongodb';

import { type IProcessingLogDocument } from '../processing-log.types.js';

import { encodeLogCursor } from './log-cursor.util.js';
import { searchLogs } from './search-logs.js';

describe('searchLogs', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const correlationId = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  function buildDocument(hexId: string, timestamp: string): WithId<IProcessingLogDocument> {
    return {
      _id: new ObjectId(hexId),
      importId,
      eventType: 'github.import.completed',
      service: 'service-a',
      status: 'completed',
      timestamp: new Date(timestamp),
      correlationId,
      archive: '2026-08-11-0.json.gz',
      metadata: { eventsProcessed: 10 },
    };
  }

  function buildCollection(documents: WithId<IProcessingLogDocument>[]): {
    collection: Collection<IProcessingLogDocument>;
    find: ReturnType<typeof vi.fn>;
    cursor: { sort: ReturnType<typeof vi.fn>; limit: ReturnType<typeof vi.fn> };
  } {
    const cursor = {
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(documents),
    };
    const find = vi.fn().mockReturnValue(cursor);

    return { collection: { find } as unknown as Collection<IProcessingLogDocument>, find, cursor };
  }

  it('should return every entry without _id and no nextCursor, when fewer documents exist than the limit', async () => {
    const documents = [buildDocument('64b7f0c2f1a2b3c4d5e6f7a1', '2026-08-11T00:02:00.000Z')];
    const { collection } = buildCollection(documents);

    const result = await searchLogs(collection, { limit: 50 });

    expect(result.nextCursor).toBeUndefined();
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).not.toHaveProperty('_id');
    expect(result.data[0]).toEqual({
      importId,
      eventType: 'github.import.completed',
      service: 'service-a',
      status: 'completed',
      timestamp: '2026-08-11T00:02:00.000Z',
      correlationId,
      archive: '2026-08-11-0.json.gz',
      metadata: { eventsProcessed: 10 },
    });
  });

  it('should return a nextCursor derived from the last returned document, when more documents exist than the limit', async () => {
    const documents = [
      buildDocument('64b7f0c2f1a2b3c4d5e6f7a1', '2026-08-11T00:02:00.000Z'),
      buildDocument('64b7f0c2f1a2b3c4d5e6f7a2', '2026-08-11T00:01:00.000Z'),
      buildDocument('64b7f0c2f1a2b3c4d5e6f7a3', '2026-08-11T00:00:00.000Z'),
    ];
    const { collection } = buildCollection(documents);

    const result = await searchLogs(collection, { limit: 2 });

    expect(result.data).toHaveLength(2);
    expect(result.nextCursor).toBe(
      encodeLogCursor({
        timestamp: new Date('2026-08-11T00:01:00.000Z'),
        id: '64b7f0c2f1a2b3c4d5e6f7a2',
      }),
    );
  });

  it('should query with limit + 1 sorted by timestamp/_id descending, when called', async () => {
    const { collection, find, cursor } = buildCollection([]);

    await searchLogs(collection, { limit: 50 });

    expect(find).toHaveBeenCalledOnce();
    const findCall = find.mock.calls[0];
    expect(findCall[0]).toEqual({});
    expect(findCall[1]).toEqual({
      projection: {
        _id: 1,
        importId: 1,
        eventType: 1,
        service: 1,
        status: 1,
        timestamp: 1,
        correlationId: 1,
        archive: 1,
        metadata: 1,
        errorInfo: 1,
      },
    });
    expect(cursor.sort).toHaveBeenCalledWith({ timestamp: -1, _id: -1 });
    expect(cursor.limit).toHaveBeenCalledWith(51);
  });

  it('should pass a projection to find() to exclude unnecessary fields', async () => {
    const { collection, find } = buildCollection([]);

    await searchLogs(collection, { limit: 50 });

    expect(find).toHaveBeenCalledOnce();
    const findCall = find.mock.calls[0];
    expect(findCall[1]).toBeDefined();
    const projection = (findCall[1] as Record<string, unknown>)?.projection;
    expect(projection).toEqual({
      _id: 1,
      importId: 1,
      eventType: 1,
      service: 1,
      status: 1,
      timestamp: 1,
      correlationId: 1,
      archive: 1,
      metadata: 1,
      errorInfo: 1,
    });
  });

  it('should decode the cursor and build a keyset filter, when a cursor is provided', async () => {
    const { collection, find } = buildCollection([]);
    const priorTimestamp = new Date('2026-08-11T00:00:00.000Z');
    const priorId = '64b7f0c2f1a2b3c4d5e6f7a3';
    const priorCursor = encodeLogCursor({ timestamp: priorTimestamp, id: priorId });

    await searchLogs(collection, { limit: 50, cursor: priorCursor });

    expect(find).toHaveBeenCalledOnce();
    const findCall = find.mock.calls[0];
    expect(findCall[0]).toEqual({
      $and: [
        {},
        {
          $or: [
            { timestamp: { $lt: priorTimestamp } },
            { timestamp: priorTimestamp, _id: { $lt: new ObjectId(priorId) } },
          ],
        },
      ],
    });
    expect(findCall[1]).toEqual({
      projection: {
        _id: 1,
        importId: 1,
        eventType: 1,
        service: 1,
        status: 1,
        timestamp: 1,
        correlationId: 1,
        archive: 1,
        metadata: 1,
        errorInfo: 1,
      },
    });
  });
});
