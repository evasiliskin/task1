import { type ICursorPage } from '@task1/shared/pagination/cursor-page.types';
import { type ILogView } from '@task1/shared/processing-log/contracts/log-view.dto';
import { type Collection } from 'mongodb';

import { type IProcessingLogDocument } from '../processing-log.types.js';

import { buildLogsFilter } from './build-logs-filter.js';
import { decodeLogCursor, encodeLogCursor } from './log-cursor.util.js';
import { type SearchLogsMessage } from './search-logs-message.schema.js';
import { toLogView } from './to-log-view.js';

const LOG_PROJECTION = {
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
} as const;

export type SearchLogsResult = ICursorPage<ILogView>;

export async function searchLogs(
  collection: Collection<IProcessingLogDocument>,
  message: SearchLogsMessage,
): Promise<SearchLogsResult> {
  const cursor = message.cursor === undefined ? undefined : decodeLogCursor(message.cursor);
  const filter = buildLogsFilter(message, cursor);

  const documents = await collection
    .find(filter, { projection: LOG_PROJECTION })
    .sort({ timestamp: -1, _id: -1 })
    .limit(message.limit + 1)
    .toArray();

  const hasNextPage = documents.length > message.limit;
  const pageDocuments = hasNextPage ? documents.slice(0, message.limit) : documents;
  const data = pageDocuments.map(toLogView);
  const lastDocument = pageDocuments.at(-1);

  if (!hasNextPage || lastDocument === undefined) {
    return { data };
  }

  return {
    data,
    nextCursor: encodeLogCursor({
      timestamp: lastDocument.timestamp,
      id: lastDocument._id.toHexString(),
    }),
  };
}
