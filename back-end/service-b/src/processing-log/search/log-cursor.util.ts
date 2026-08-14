import { decodeCursor, encodeCursor } from '@task1/shared';
import { z } from 'zod';

import { InvalidCursorError } from './errors.js';

const cursorPayloadSchema = z.object({
  timestamp: z.string().datetime(),
  id: z.string().regex(/^[0-9a-fA-F]{24}$/),
});

export interface ILogCursor {
  timestamp: Date;
  id: string;
}

export function encodeLogCursor(cursor: ILogCursor): string {
  return encodeCursor({
    timestamp: cursor.timestamp.toISOString(),
    id: cursor.id,
  });
}

export function decodeLogCursor(cursor: string): ILogCursor {
  const decoded = decodeCursor(cursor, cursorPayloadSchema);

  if (decoded === null) {
    throw new InvalidCursorError(cursor);
  }

  return { timestamp: new Date(decoded.timestamp), id: decoded.id };
}
