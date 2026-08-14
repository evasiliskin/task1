import { type Document, type Filter } from 'mongodb';

import { type IProcessingLogDocument } from '../processing-log.types.js';

export function buildStatsPipeline(importId?: string): Document[] {
  const match: Filter<IProcessingLogDocument> = importId === undefined ? {} : { importId };

  return [
    { $match: match },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        eventsProcessed: { $sum: '$metadata.eventsProcessed' },
        validEvents: { $sum: '$metadata.validEvents' },
        invalidEvents: { $sum: '$metadata.invalidEvents' },
        errorCount: { $sum: '$metadata.errorCount' },
      },
    },
  ];
}
