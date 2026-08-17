import { type Filter } from 'mongodb';

import { type ImportDeliveryKind } from './import-delivery-kind.js';
import { type IImportRunDocument } from './import-run.types.js';

export function buildReopenRunFilter(
  importId: string,
  delivery: ImportDeliveryKind,
  staleBefore: Date,
): Filter<IImportRunDocument> | undefined {
  if (delivery === 'fresh') {
    return undefined;
  }

  if (delivery === 'redelivery') {
    return { importId, startedAt: { $exists: true } };
  }

  return {
    importId,
    startedAt: { $exists: true },
    $or: [{ status: { $ne: 'started' } }, { startedAt: { $lt: staleBefore } }],
  };
}

export function buildStartRunFilter(importId: string): Filter<IImportRunDocument> {
  return { importId, startedAt: { $exists: false } };
}
