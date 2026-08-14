import { ObjectId } from 'mongodb';

import { buildLogsFilter } from './build-logs-filter.js';

describe('buildLogsFilter', () => {
  const baseMessage = { limit: 50 };
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  it('should return an empty filter, when no filters or cursor are provided', () => {
    expect(buildLogsFilter(baseMessage)).toEqual({});
  });

  it('should filter by importId, when importId is provided', () => {
    expect(buildLogsFilter({ ...baseMessage, importId })).toEqual({ importId });
  });

  it('should filter by status, when status is provided', () => {
    expect(buildLogsFilter({ ...baseMessage, status: 'completed' })).toEqual({
      status: 'completed',
    });
  });

  it('should filter timestamp with only $gte, when only from is provided', () => {
    expect(buildLogsFilter({ ...baseMessage, from: '2026-08-01T00:00:00.000Z' })).toEqual({
      timestamp: { $gte: new Date('2026-08-01T00:00:00.000Z') },
    });
  });

  it('should filter timestamp with both $gte and $lte, when from and to are both provided', () => {
    expect(
      buildLogsFilter({
        ...baseMessage,
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-11T00:00:00.000Z',
      }),
    ).toEqual({
      timestamp: {
        $gte: new Date('2026-08-01T00:00:00.000Z'),
        $lte: new Date('2026-08-11T00:00:00.000Z'),
      },
    });
  });

  it('should combine every provided filter field, when all are present', () => {
    expect(buildLogsFilter({ ...baseMessage, importId, status: 'failed' })).toEqual({
      importId,
      status: 'failed',
    });
  });

  it('should wrap the filter in a keyset $and/$or clause, when a cursor is provided', () => {
    const cursorTimestamp = new Date('2026-08-11T00:00:00.000Z');
    const cursorId = '64b7f0c2f1a2b3c4d5e6f7a1';

    expect(
      buildLogsFilter(
        { ...baseMessage, status: 'completed' },
        { timestamp: cursorTimestamp, id: cursorId },
      ),
    ).toEqual({
      $and: [
        { status: 'completed' },
        {
          $or: [
            { timestamp: { $lt: cursorTimestamp } },
            { timestamp: cursorTimestamp, _id: { $lt: new ObjectId(cursorId) } },
          ],
        },
      ],
    });
  });
});
