import { type ILogView } from '@task1/shared/processing-log/contracts/log-view.dto';
import { type WithId } from 'mongodb';

import { type IProcessingLogDocument } from '../processing-log.types.js';

export function toLogView(document: WithId<IProcessingLogDocument>): ILogView {
  const view: ILogView = {
    importId: document.importId,
    eventType: document.eventType,
    service: document.service,
    status: document.status,
    timestamp: document.timestamp.toISOString(),
    correlationId: document.correlationId,
    archive: document.archive,
    metadata: document.metadata,
  };

  if (document.errorInfo !== undefined) {
    view.errorInfo = document.errorInfo;
  }

  return view;
}
