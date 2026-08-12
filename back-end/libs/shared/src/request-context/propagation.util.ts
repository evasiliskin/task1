import { randomUUID } from 'node:crypto';

import {
  CORRELATION_ID_HEADER,
  type IRequestContext,
  REQUEST_ID_HEADER,
} from './request-context.types.js';

export function buildOutboundHeaders(context: IRequestContext): Record<string, string> {
  return {
    [CORRELATION_ID_HEADER]: context.correlationId,
    [REQUEST_ID_HEADER]: randomUUID(),
  };
}
