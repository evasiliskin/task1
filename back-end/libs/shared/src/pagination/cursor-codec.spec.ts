import { z } from 'zod';

import { decodeCursor, encodeCursor } from './cursor-codec.js';

const payloadSchema = z.object({ id: z.string() });

describe('cursor codec', () => {
  it('should round-trip a payload through base64url', () => {
    const encoded = encodeCursor({ id: 'abc' });

    expect(decodeCursor(encoded, payloadSchema)).toEqual({ id: 'abc' });
  });

  it('should return null for a cursor that is not valid base64url JSON', () => {
    expect(decodeCursor('!!!not-base64!!!', payloadSchema)).toBeNull();
  });

  it('should return null for a well-formed cursor whose payload fails the schema', () => {
    expect(decodeCursor(encodeCursor({ wrong: 1 }), payloadSchema)).toBeNull();
  });
});
