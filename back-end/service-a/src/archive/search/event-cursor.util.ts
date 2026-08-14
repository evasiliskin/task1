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
  const payload = JSON.stringify({
    createdAt: cursor.createdAt.toISOString(),
    eventId: cursor.eventId,
  });

  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeEventCursor(cursor: string): IEventCursor {
  let decodedPayload: unknown;

  try {
    decodedPayload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch (error) {
    throw new InvalidCursorError(cursor, error instanceof Error ? error : undefined);
  }

  const result = cursorPayloadSchema.safeParse(decodedPayload);

  if (!result.success) {
    throw new InvalidCursorError(cursor);
  }

  return { createdAt: new Date(result.data.createdAt), eventId: result.data.eventId };
}
