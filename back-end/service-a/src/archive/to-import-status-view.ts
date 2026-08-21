import { type IImportStatusView } from '@task1/shared/github-archive/index';

import { type IImportRunDocument } from './import-run.types.js';

export function toImportStatusView(document: IImportRunDocument): IImportStatusView {
  return {
    importId: document.importId,
    source: document.source,
    status: document.status,
    startedAt: document.startedAt.toISOString(),
    ...(document.completedAt === undefined
      ? {}
      : { completedAt: document.completedAt.toISOString() }),
    ...(document.failedAt === undefined ? {} : { failedAt: document.failedAt.toISOString() }),
    ...(document.eventsProcessed === undefined
      ? {}
      : { eventsProcessed: document.eventsProcessed }),
    ...(document.validEvents === undefined ? {} : { validEvents: document.validEvents }),
    ...(document.invalidEvents === undefined ? {} : { invalidEvents: document.invalidEvents }),
    ...(document.duplicateEvents === undefined
      ? {}
      : { duplicateEvents: document.duplicateEvents }),
    ...(document.errorCount === undefined ? {} : { errorCount: document.errorCount }),
    ...(document.errorSamples === undefined ? {} : { errorSamples: document.errorSamples }),
  };
}
