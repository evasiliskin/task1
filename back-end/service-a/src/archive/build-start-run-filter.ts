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

  const notCompleted: Filter<IImportRunDocument> = {
    importId,
    startedAt: { $exists: true },
    status: { $ne: 'completed' },
  };

  if (delivery === 'redelivery') {
    return notCompleted;
  }

  return {
    ...notCompleted,
    $or: [{ status: { $ne: 'started' } }, { startedAt: { $lt: staleBefore } }],
  };
}

export function buildStartRunFilter(importId: string): Filter<IImportRunDocument> {
  return { importId, startedAt: { $exists: false } };
}

export function buildRecordStartedFilter(
  importId: string,
  delivery: ImportDeliveryKind,
  staleBefore: Date,
): Filter<IImportRunDocument> {
  const reopenFilter = buildReopenRunFilter(importId, delivery, staleBefore);

  if (reopenFilter === undefined) {
    return buildStartRunFilter(importId);
  }

  return { $or: [buildStartRunFilter(importId), reopenFilter] };
}
