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
  const payload = JSON.stringify({
    timestamp: cursor.timestamp.toISOString(),
    id: cursor.id,
  });

  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeLogCursor(cursor: string): ILogCursor {
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

  return { timestamp: new Date(result.data.timestamp), id: result.data.id };
}
