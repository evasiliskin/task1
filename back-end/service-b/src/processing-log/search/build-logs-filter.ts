import { type Filter, ObjectId } from 'mongodb';

import { type IProcessingLogDocument } from '../processing-log.types.js';

import { type ILogCursor } from './log-cursor.util.js';
import { type SearchLogsMessage } from './search-logs-message.schema.js';

export function buildLogsFilter(
  message: SearchLogsMessage,
  cursor?: ILogCursor,
): Filter<IProcessingLogDocument> {
  const filter: Filter<IProcessingLogDocument> = {};

  if (message.importId !== undefined) {
    filter.importId = message.importId;
  }

  if (message.status !== undefined) {
    filter.status = message.status;
  }

  if (message.from !== undefined || message.to !== undefined) {
    filter.timestamp = {
      ...(message.from === undefined ? {} : { $gte: new Date(message.from) }),
      ...(message.to === undefined ? {} : { $lte: new Date(message.to) }),
    };
  }

  if (cursor === undefined) {
    return filter;
  }

  return {
    $and: [
      filter,
      {
        $or: [
          { timestamp: { $lt: cursor.timestamp } },
          { timestamp: cursor.timestamp, _id: { $lt: new ObjectId(cursor.id) } },
        ],
      },
    ],
  };
}
