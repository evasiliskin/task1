import { decodeCursor, encodeCursor } from '@task1/shared';
import { z } from 'zod';

import { InvalidCursorError } from './errors.js';

const cursorPayloadSchema = z.object({
  createdAt: z.iso.datetime(),
  eventId: z.string().min(1),
});

export interface IEventCursor {
  createdAt: Date;
  eventId: string;
}

export function encodeEventCursor(cursor: IEventCursor): string {
  return encodeCursor({
    createdAt: cursor.createdAt.toISOString(),
    eventId: cursor.eventId,
  });
}

export function decodeEventCursor(cursor: string): IEventCursor {
  const decoded = decodeCursor(cursor, cursorPayloadSchema);

  if (decoded === null) {
    throw new InvalidCursorError(cursor);
  }

  return { createdAt: new Date(decoded.createdAt), eventId: decoded.eventId };
}
