import { type Collection, type WithId } from 'mongodb';

import { type IProcessingLogDocument } from '../processing-log.types.js';

import { buildLogsFilter } from './build-logs-filter.js';
import { decodeLogCursor, encodeLogCursor } from './log-cursor.util.js';
import { type SearchLogsMessage } from './search-logs-message.schema.js';

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

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- deliberately a `type`, not an `I`-prefixed `interface`: matches the brief's `SearchLogsResult` shape consumed by Task 6's `LogsSearchService`.
export type SearchLogsResult = {
  data: IProcessingLogDocument[];
  nextCursor?: string;
};

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
  const data = pageDocuments.map(toLogEntry);
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

function toLogEntry(document: WithId<IProcessingLogDocument>): IProcessingLogDocument {
  const entry: IProcessingLogDocument = {
    importId: document.importId,
    eventType: document.eventType,
    service: document.service,
    status: document.status,
    timestamp: document.timestamp,
    correlationId: document.correlationId,
    archive: document.archive,
    metadata: document.metadata,
  };

  if (document.errorInfo !== undefined) {
    entry.errorInfo = document.errorInfo;
  }

  return entry;
}
